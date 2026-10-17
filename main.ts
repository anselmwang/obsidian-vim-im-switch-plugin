import { App, MarkdownView, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { execFile, ChildProcess } from 'child_process';
import { extname } from 'path';

interface Settings {
	fcitxRemotePath_macOS: string;
	fcitxRemotePath_windows: string;
	fcitxRemotePath_linux: string;
}

const DEFAULT_SETTINGS: Settings = {
	fcitxRemotePath_macOS: '/usr/local/bin/fcitx-remote',
	fcitxRemotePath_windows: '',
	fcitxRemotePath_linux: '/usr/bin/fcitx-remote',
};

enum IMStatus {
	None,
	Activate,
	Deactivate,
}

type Mode = 'insert' | 'replace' | 'normal' | 'visual';
type ModeHandler = () => void;
interface VimEditor {
	state: { vim?: { insertMode?: boolean; visualMode?: boolean }; overwrite?: boolean };
	on(event: 'vim-mode-change', handler: ModeHandler): void;
	off(event: 'vim-mode-change', handler: ModeHandler): void;
}
interface EditorContext {
	kind: 'editor';
	view: MarkdownView;
	cm: VimEditor;
	mode: Mode;
	ready: boolean;
}
type Context = EditorContext | { kind: 'inactive' | 'other' | 'command'; ready?: boolean };

/** Keep this object opaque; only pass it back to the instance that created it. */
export interface EnglishOverride {
	readonly ready: Promise<void>;
}
interface Owner extends EnglishOverride {
	ready: Promise<void>;
	element: Element | null;
	outside: boolean;
	previous: IMStatus;
}

function record(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function isVimEditor(cm: unknown): cm is VimEditor {
	if (!record(cm) || !record(cm.state) || typeof cm.on !== 'function' || typeof cm.off !== 'function')
		return false;
	const vim = cm.state.vim;
	return (cm.state.overwrite === undefined || typeof cm.state.overwrite === 'boolean') &&
		(vim === undefined || (record(vim) &&
			(vim.insertMode === undefined || typeof vim.insertMode === 'boolean') &&
			(vim.visualMode === undefined || typeof vim.visualMode === 'boolean')));
}

// Obsidian's CM6 Vim bridge is not part of its public API. Validate at this boundary.
function getEditor(view: MarkdownView | null): VimEditor | null {
	const internal: unknown = view;
	if (!record(internal)) return null;
	const edit = internal.editMode;
	const source = internal.sourceMode;
	for (const wrapper of [
		record(edit) && record(edit.editor) ? edit.editor.cm : null,
		record(source) && record(source.cmEditor) ? source.cmEditor.cm : null,
	]) {
		const cm = record(wrapper) ? wrapper.cm : null;
		if (isVimEditor(cm)) return cm;
	}
	return null;
}

export default class VimInputMethodMemory extends Plugin {
	settings: Settings = { ...DEFAULT_SETTINGS };
	disposed = false;
	private imStatus = IMStatus.None;
	private operationQueue: Promise<void> = Promise.resolve();
	private revision = 0;
	private writeRevision = 0;
	private context: Context | null = null;
	private cmEditor: VimEditor | null = null;
	private boundView: MarkdownView | null = null;
	private boundHandler: ModeHandler | null = null;
	private englishOwners = new Set<Owner>();
	private overrideOrigin: Owner | null = null;
	private legacyOwners: EnglishOverride[] = [];
	private runningHelper: ChildProcess | null = null;
	private diagnostics = false;
	private debugRows: Array<{ event: string; revision: number; at: string; durationMs?: number }> = [];
	private lastErrorAt = -Infinity;

	async onload(): Promise<void> {
		const saved: unknown = await this.loadData();
		for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof Settings>) {
			if (record(saved) && typeof saved[key] === 'string') this.settings[key] = saved[key];
		}
		this.addSettingTab(new MemorySettingTab(this.app, this));
		const sync = () => { void this.requestSync(); };
		this.registerEvent(this.app.workspace.on('file-open', sync));
		this.registerEvent(this.app.workspace.on('active-leaf-change', sync));
		this.registerEvent(this.app.workspace.on('layout-change', sync));
		this.registerDomEvent(document, 'focusin', () => { void this.requestSync(); }, true);
		this.registerDomEvent(window, 'blur', () => {
			this.cancelHelper();
			void this.requestSync();
		});
		this.registerDomEvent(window, 'focus', () => { void this.requestSync(); });
		this.app.workspace.onLayoutReady(() => { void this.requestSync(); });
		this.addCommand({
			id: 'toggle-diagnostics',
			name: 'Toggle input method diagnostics',
			callback: () => {
				this.diagnostics = !this.diagnostics;
				this.debugRows = [];
				new Notice(`Input method diagnostics ${this.diagnostics ? 'enabled (developer console)' : 'disabled'}.`);
			},
		});
		this.addCommand({
			id: 'push-im-status',
			name: 'Temporarily use English',
			callback: () => {
				const owner = this.beginEnglishOverride('command');
				this.legacyOwners.push(owner);
				void owner.ready.catch(() => {
					this.legacyOwners = this.legacyOwners.filter(item => item !== owner);
					this.endEnglishOverride(owner);
				});
			},
		});
		this.addCommand({
			id: 'pop-im-status',
			name: 'Release temporary English',
			callback: () => {
				const owner = this.legacyOwners.pop();
				if (owner) this.endEnglishOverride(owner);
			},
		});
	}

	private trace(event: string, durationMs?: number): void {
		if (!this.diagnostics) return;
		const row = { event, revision: this.revision, at: new Date().toISOString(), durationMs };
		this.debugRows.push(row);
		if (this.debugRows.length > 500) this.debugRows.shift();
		console.debug('[Vim Input Method Memory]', row);
	}

	private reportError(error: unknown): void {
		// Do not log execFile errors verbatim: they may contain the configured private path.
		const code = record(error) && typeof error.code === 'string' ? error.code : 'synchronization';
		const message = error instanceof Error ? error.message : 'Synchronization failed.';
		console.error(`[Vim Input Method Memory] ${code}: ${message}`);
		if (Date.now() - this.lastErrorAt > 5000) {
			this.lastErrorAt = Date.now();
			new Notice('Input method synchronization failed. Check the helper path, protocol and Vim editor support. See the developer console.');
		}
	}

	private enqueue(operation: () => Promise<void>): Promise<void> {
		const result = this.operationQueue.then(async () => {
			if (!this.disposed) await operation();
		});
		this.operationQueue = result.catch(error => this.reportError(error));
		return result;
	}

	private bindEditor(): void {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const cm = getEditor(view);
		if (cm === this.cmEditor && view === this.boundView) return;
		this.detachEditor();
		this.cmEditor = cm;
		this.boundView = view;
		if (cm) {
			this.boundHandler = () => {
				if (this.cmEditor === cm && this.app.workspace.getActiveViewOfType(MarkdownView) === view)
					void this.requestSync();
			};
			cm.on('vim-mode-change', this.boundHandler);
		}
	}

	private detachEditor(): void {
		if (this.cmEditor && this.boundHandler) this.cmEditor.off('vim-mode-change', this.boundHandler);
		this.cmEditor = null;
		this.boundView = null;
		this.boundHandler = null;
	}

	private readContext(): Context {
		if (this.disposed || !document.hasFocus()) return { kind: 'inactive' };
		this.bindEditor();
		if (this.englishOwners.size) return { kind: 'command' };
		const view = this.boundView;
		const cm = this.cmEditor;
		const target = document.activeElement;
		if (!view || !target?.closest('.markdown-source-view') || !view.containerEl.contains(target))
			return { kind: 'other' };
		const app: unknown = this.app;
		if (record(app) && typeof app.isVimEnabled === 'function' && !app.isVimEnabled())
			return { kind: 'other' };
		if (!cm?.state.vim) throw new Error('Cannot read the active editor Vim bridge.');
		const vim = cm.state.vim;
		const mode = vim.insertMode ? (cm.state.overwrite ? 'replace' : 'insert') :
			vim.visualMode ? 'visual' : 'normal';
		return { kind: 'editor', view, cm, mode, ready: false };
	}

	private isInput(context: Context | null): context is EditorContext {
		return context?.kind === 'editor' && (context.mode === 'insert' || context.mode === 'replace');
	}

	private sameContext(a: Context | null, b: Context): boolean {
		return a?.kind === b.kind && (a.kind !== 'editor' ||
			(b.kind === 'editor' && a.cm === b.cm && a.view === b.view && a.mode === b.mode));
	}

	private canSample(context: EditorContext): boolean {
		const target = document.activeElement;
		return !this.disposed && document.hasFocus() &&
			this.app.workspace.getActiveViewOfType(MarkdownView) === context.view &&
			getEditor(context.view) === context.cm && !!target?.closest('.markdown-source-view') &&
			context.view.containerEl.contains(target);
	}

	private requestSync(): Promise<void> {
		if (this.disposed) return this.operationQueue;
		let next: Context;
		try {
			next = this.readContext();
		} catch (error) {
			this.revision++;
			this.context = null;
			this.reportError(error);
			return this.operationQueue;
		}
		const previous = this.context;
		if (this.sameContext(previous, next)) next.ready = previous?.ready;
		this.context = next;
		const revision = ++this.revision;
		const sample = this.isInput(previous) && previous.ready && next.kind === 'editor' &&
			previous.cm === next.cm && !this.isInput(next) ? previous : null;
		const writeRevision = this.writeRevision;
		this.trace('state.request');
		void this.enqueue(async () => {
			try {
				if (sample && this.writeRevision === writeRevision && this.canSample(sample))
					await this.rememberInput(sample);
			} finally {
				if (revision === this.revision) await this.reconcile(revision);
			}
		});
		return this.operationQueue;
	}

	private async rememberInput(context: EditorContext): Promise<void> {
		const status = await this.queryStatus();
		if (this.canSample(context)) this.imStatus = status;
	}

	private async reconcile(revision: number): Promise<void> {
		const current = this.readContext();
		if (!this.sameContext(this.context, current)) {
			void this.requestSync();
			return;
		}
		if (current.kind !== 'command' && current.kind !== 'editor') return;
		const input = this.isInput(current);
		if ((input || current.kind === 'command') && this.context?.ready) return;
		if (input && this.imStatus === IMStatus.None) {
			await this.rememberInput(current);
		} else {
			await this.setStatus(input ? this.imStatus : IMStatus.Deactivate);
		}
		if (revision === this.revision && this.context && this.sameContext(current, this.readContext()))
			this.context.ready = true;
	}

	beginEnglishOverride(_reason: string): EnglishOverride {
		if (this.disposed) throw new Error('Input method plugin is unloaded.');
		const before = this.readContext();
		const sample = this.isInput(before) && (this.context?.ready || this.imStatus === IMStatus.None) ? before : null;
		const writeRevision = this.writeRevision;
		const first = this.englishOwners.size === 0;
		const owner: Owner = {
			element: document.activeElement, outside: before.kind === 'other',
			previous: IMStatus.None, ready: Promise.resolve(),
		};
		if (first) this.overrideOrigin = owner;
		const origin = this.overrideOrigin;
		this.englishOwners.add(owner);
		this.context = { kind: document.hasFocus() ? 'command' : 'inactive' };
		++this.revision;
		owner.ready = this.enqueue(async () => {
			// A nested owner may still need the first owner's sample after that owner releases.
			if (!this.englishOwners.size || this.overrideOrigin !== origin) return;
			if (!document.hasFocus()) throw new Error('Cannot prepare English in an inactive window.');
			if (first && sample && this.writeRevision === writeRevision && this.canSample(sample))
				await this.rememberInput(sample);
			if (first && owner.outside && document.activeElement === owner.element)
				owner.previous = await this.queryStatus();
			if (this.englishOwners.size && this.overrideOrigin === origin) {
				await this.setStatus(IMStatus.Deactivate);
				if (this.englishOwners.size && this.context?.kind === 'command' && document.hasFocus())
					this.context.ready = true;
			}
		});
		return owner;
	}

	endEnglishOverride(owner: EnglishOverride): void {
		const owned = Array.from(this.englishOwners).find(item => item === owner);
		if (!owned || this.disposed) return;
		this.englishOwners.delete(owned);
		const origin = this.englishOwners.size ? null : this.overrideOrigin;
		if (!this.englishOwners.size) this.overrideOrigin = null;
		void this.requestSync();
		const revision = this.revision;
		if (origin?.outside && origin.previous !== IMStatus.None) {
			void this.enqueue(async () => {
				if (revision === this.revision && !this.englishOwners.size && document.hasFocus() &&
					document.activeElement === origin.element && this.readContext().kind === 'other')
					await this.setStatus(origin.previous);
			});
		}
	}

	private helperPath(): string {
		const path = process.platform === 'win32' ? this.settings.fcitxRemotePath_windows :
			process.platform === 'darwin' ? this.settings.fcitxRemotePath_macOS :
				process.platform === 'linux' ? this.settings.fcitxRemotePath_linux : '';
		if (!path.trim()) throw new Error('Configure a supported input method helper first.');
		return process.platform === 'win32' && !extname(path) ? `${path}.exe` : path;
	}

	private async runHelper(args: string[]): Promise<string> {
		if (this.disposed || !document.hasFocus()) throw new Error('Input method window is inactive.');
		const executable = this.helperPath();
		const start = Date.now();
		this.trace(args.length ? 'helper.set' : 'helper.query');
		try {
			return await new Promise<string>((resolve, reject) => {
				this.runningHelper = execFile(executable, args,
					{ windowsHide: true, shell: false, timeout: 5000, maxBuffer: 64 * 1024, encoding: 'utf8' },
					(error, stdout) => {
						this.runningHelper = null;
						if (error) {
							const code = error.killed ? 'HELPER_TIMEOUT_OR_CANCELLED' :
								typeof error.code === 'string' ? error.code : 'HELPER_EXIT_FAILURE';
							reject(new Error(`Input method helper failed (${code}); timeout is 5000 ms.`));
						}
						else if (this.disposed || !document.hasFocus()) reject(new Error('Helper completed after focus loss.'));
						else resolve(stdout);
					});
			});
		} finally {
			this.trace('helper.complete', Date.now() - start);
		}
	}

	private async queryStatus(): Promise<IMStatus> {
		const output = (await this.runHelper([])).trim();
		if (output === '1') return IMStatus.Deactivate;
		if (output === '2') return IMStatus.Activate;
		throw new Error('Helper must return 1 (English) or 2 (active input method).');
	}

	private async setStatus(status: IMStatus): Promise<void> {
		this.writeRevision++;
		await this.runHelper([status === IMStatus.Activate ? '-o' : '-c']);
	}

	private cancelHelper(): void {
		if (this.runningHelper && !this.runningHelper.kill())
			this.reportError(new Error('Could not stop the input method helper.'));
	}

	onunload(): void {
		this.disposed = true;
		++this.revision;
		this.englishOwners.clear();
		this.overrideOrigin = null;
		this.legacyOwners = [];
		this.cancelHelper();
		this.detachEditor();
		this.debugRows = [];
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		if (this.context) this.context.ready = false;
		void this.requestSync();
	}
}

class MemorySettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: VimInputMethodMemory) {
		super(app, plugin);
	}

	display(): void {
		this.containerEl.empty();
		for (const [key, platform] of [
			['fcitxRemotePath_windows', 'Windows'],
			['fcitxRemotePath_linux', 'Linux'],
			['fcitxRemotePath_macOS', 'macOS'],
		] as const) {
			new Setting(this.containerEl)
				.setName(`Input method helper for ${platform}`)
				.setDesc('Trusted fcitx-remote-compatible executable path, without quotes or command arguments.')
				.addText(text => text
					.setPlaceholder(DEFAULT_SETTINGS[key])
					.setValue(this.plugin.settings[key])
					.onChange(async value => {
						this.plugin.settings[key] = value;
						try {
							await this.plugin.saveSettings();
						} catch {
							new Notice('Could not save input method settings.');
						}
					}));
		}
	}
}
