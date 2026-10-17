const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

async function setup({ preference = '2', mode = 'insert', platform = 'win32', bridge = 'edit' } = {}) {
	const h = {
		physical: preference, focused: true, vimEnabled: true, listeners: [], workspaceEvents: [],
		modeEvents: [], calls: [], errors: [], notices: [], logs: [], commands: {},
		hold: null, pending: null, fail: null, concurrent: 0, peak: 0, killed: 0,
	};
	const document = { hasFocus: () => h.focused, activeElement: null };
	const window = {};
	class MarkdownView {}
	h.makeView = (mode, bridge = 'edit') => {
		const view = new MarkdownView();
		view.target = { closest: selector => selector === '.markdown-source-view' ? view.target : null };
		view.containerEl = { contains: element => element === view.target };
		view.cm = {
			state: {},
			on: (name, fn) => h.modeEvents.push({ cm: view.cm, name, fn }),
			off: (name, fn) => { h.modeEvents = h.modeEvents.filter(e => e.cm !== view.cm || e.name !== name || e.fn !== fn); },
		};
		h.setMode(mode, view);
		if (bridge === 'edit') view.editMode = { editor: { cm: { cm: view.cm } } };
		else view.sourceMode = { cmEditor: { cm: { cm: view.cm } } };
		return view;
	};
	h.setMode = (mode, view = h.active) => {
		view.cm.state = {
			vim: { insertMode: mode === 'insert' || mode === 'replace', visualMode: mode === 'visual' },
			overwrite: mode === 'replace',
		};
	};
	h.fire = (name, target = document) => {
		for (const event of h.listeners.slice()) if (event.name === name && event.target === target) event.fn();
	};
	h.focus = target => { document.activeElement = target; h.fire('focusin'); };
	h.mode = mode => {
		h.setMode(mode);
		for (const event of h.modeEvents.slice()) if (event.cm === h.active.cm) event.fn({ mode: 'intentionally-wrong' });
	};
	h.switchTo = view => {
		h.active = view;
		h.focus(view ? view.target : { closest: () => null });
		for (const name of ['file-open', 'active-leaf-change', 'layout-change'])
			for (const event of h.workspaceEvents.slice()) if (event.name === name) event.fn();
	};
	h.blur = () => { h.focused = false; h.fire('blur', window); };
	h.refocus = () => { h.focused = true; h.fire('focus', window); };
	h.active = h.makeView(mode, bridge);
	document.activeElement = h.active.target;
	const app = {
		isVimEnabled: () => h.vimEnabled,
		workspace: {
			getActiveViewOfType: () => h.active,
			on(name, fn) { const event = { name, fn }; h.workspaceEvents.push(event); return event; },
			onLayoutReady(fn) { h.layoutReady = fn; fn(); },
		},
	};
	class Plugin {
		constructor() { this.app = app; this.cleanups = []; }
		register(fn) { this.cleanups.push(fn); }
		registerEvent(event) {
			this.register(() => { h.workspaceEvents = h.workspaceEvents.filter(item => item !== event); });
		}
		registerDomEvent(target, name, fn) {
			const event = { target, name, fn }; h.listeners.push(event);
			this.register(() => { h.listeners = h.listeners.filter(item => item !== event); });
		}
		addSettingTab() {}
		addCommand(command) { h.commands[command.id] = command.callback; }
		async loadData() {
			return {
				fcitxRemotePath_windows: 'C:\\helper path\\fcitx-remote',
				fcitxRemotePath_linux: '/helper path/fcitx-remote',
				fcitxRemotePath_macOS: '/helper path/fcitx-remote',
			};
		}
		async saveData() {}
	}
	const execFile = (executable, args, options, callback) => {
		const operation = args[0] || 'query';
		assert.equal(options.shell, false);
		assert.equal(options.windowsHide, true);
		assert.equal(options.timeout, 5000);
		assert.equal(options.maxBuffer, 65536);
		assert.equal(h.focused, true, 'must not launch while unfocused');
		h.calls.push({ executable, args: Array.from(args), operation });
		h.concurrent++;
		h.peak = Math.max(h.peak, h.concurrent);
		let done = false;
		const finish = (error = null) => {
			if (done) return;
			done = true;
			h.concurrent--;
			if (error || h.fail) {
				const failure = error || h.fail; h.fail = null;
				callback(failure, '');
			} else {
				if (operation === '-c') h.physical = '1';
				if (operation === '-o') h.physical = '2';
				callback(null, operation === 'query' ? h.physical : '');
			}
		};
		if (h.hold === operation) { h.hold = null; h.pending = finish; }
		else queueMicrotask(() => finish());
		return { kill() { h.killed++; queueMicrotask(() => finish({ killed: true })); return true; } };
	};
	const module = { exports: {} };
	const context = vm.createContext({
		module, exports: module.exports, document, window, process: { platform },
		console: { error: (...args) => h.errors.push(args.join(' ')), debug: (...args) => h.logs.push(args) },
		require(name) {
			if (name === 'obsidian') return {
				Plugin, MarkdownView, PluginSettingTab: class {},
				Notice: class { constructor(message) { h.notices.push(message); } },
			};
			if (name === 'child_process') return { execFile };
			if (name === 'path') return path;
			throw new Error(`Unexpected bundled dependency: ${name}`);
		},
	});
	new vm.Script(source).runInContext(context);
	h.plugin = new module.exports();
	h.document = document;
	h.settle = async () => {
		for (let i = 0; i < 50; i++) await Promise.resolve();
		if (!h.pending) {
			const queue = h.plugin.operationQueue;
			await queue;
			if (queue !== h.plugin.operationQueue) await h.settle();
		}
	};
	h.finish = () => { assert.ok(h.pending); const pending = h.pending; h.pending = null; pending(); };
	h.unload = () => { h.plugin.onunload(); for (const cleanup of h.plugin.cleanups) cleanup(); };
	await h.plugin.onload();
	await h.settle();
	return h;
}

for (const preference of ['1', '2']) {
	for (const mode of ['normal', 'visual', 'insert', 'replace']) {
		for (const action of ['cancel', 'jump']) {
			test(`${preference} preference: ${mode} menu ${action}`, async () => {
				const h = await setup({ preference });
				h.mode(mode); await h.settle();
				const owner = h.plugin.beginEnglishOverride('key-sequence');
				assert.ok(owner && typeof owner.ready.then === 'function');
				await owner.ready;
				assert.equal(h.physical, '1');
				if (action === 'jump') h.switchTo(h.makeView('normal'));
				h.plugin.endEnglishOverride(owner);
				await h.settle();
				const expected = action === 'cancel' && ['insert', 'replace'].includes(mode) ? preference : '1';
				assert.equal(h.physical, expected);
				assert.equal(h.plugin.imStatus, preference === '2' ? 1 : 2);
				h.mode('insert'); await h.settle();
				assert.equal(h.physical, preference);
				assert.equal(h.peak, 1);
			});
		}
	}
}

test('manual English survives Normal, Replace and subsequent menus', async () => {
	const h = await setup();
	h.physical = '1';
	h.focus(h.active.target); await h.settle();
	assert.equal(h.physical, '1');
	h.mode('normal'); await h.settle();
	h.mode('replace'); await h.settle();
	assert.equal(h.physical, '1');
	const owner = h.plugin.beginEnglishOverride('menu');
	await owner.ready;
	h.plugin.endEnglishOverride(owner); await h.settle();
	assert.equal(h.physical, '1');
});

test('actual Vim flags, not stale event payloads, determine mode on both bridges', async () => {
	for (const bridge of ['edit', 'source']) {
		const h = await setup({ bridge });
		h.mode('normal'); await h.settle();
		assert.equal(h.physical, '1');
		h.mode('replace'); await h.settle();
		assert.equal(h.physical, '2');
	}
});

test('delayed sample followed by Insert does not force stale English', async () => {
	const h = await setup();
	h.hold = 'query'; h.mode('normal'); await h.settle();
	h.mode('insert'); h.finish(); await h.settle();
	assert.equal(h.physical, '2');
	assert.equal(h.peak, 1);
});

test('in-flight Chinese write is corrected by newest Normal state', async () => {
	const h = await setup();
	h.mode('normal'); await h.settle();
	h.hold = '-o'; h.mode('insert'); await h.settle();
	h.mode('normal'); h.finish(); await h.settle();
	assert.equal(h.physical, '1');
	assert.equal(h.plugin.imStatus, 1);
	assert.equal(h.peak, 1);
});

test('rapid mode flips settle on latest state without sampling forced English', async () => {
	const h = await setup();
	h.mode('normal'); h.mode('insert'); h.mode('visual'); await h.settle();
	assert.equal(h.physical, '1');
	h.mode('insert'); await h.settle();
	assert.equal(h.physical, '2');
});

test('scoped owners are idempotent and cannot release another owner', async () => {
	const h = await setup();
	const first = h.plugin.beginEnglishOverride('first');
	const second = h.plugin.beginEnglishOverride('second');
	await Promise.all([first.ready, second.ready]);
	h.plugin.endEnglishOverride({ ready: Promise.resolve() });
	h.plugin.endEnglishOverride(first); h.plugin.endEnglishOverride(first); await h.settle();
	assert.equal(h.plugin.englishOwners.size, 1);
	assert.equal(h.physical, '1');
	h.plugin.endEnglishOverride(second); await h.settle();
	assert.equal(h.physical, '2');
});

test('first owner released before its queued sample still preserves manual preference for nested owner', async () => {
	const h = await setup();
	h.physical = '1';
	const first = h.plugin.beginEnglishOverride('first');
	const second = h.plugin.beginEnglishOverride('second');
	h.plugin.endEnglishOverride(first);
	await second.ready;
	h.plugin.endEnglishOverride(second); await h.settle();
	assert.equal(h.physical, '1');
	assert.equal(h.plugin.imStatus, 2);
});

test('old override cannot interfere with a later override during a held sample', async () => {
	const h = await setup();
	h.hold = 'query';
	const first = h.plugin.beginEnglishOverride('first'); await h.settle();
	h.plugin.endEnglishOverride(first);
	const second = h.plugin.beginEnglishOverride('second');
	h.finish(); await Promise.all([first.ready, second.ready]);
	h.plugin.endEnglishOverride(first); await h.settle();
	assert.equal(h.physical, '1');
	h.plugin.endEnglishOverride(second); await h.settle();
	assert.equal(h.physical, '2');
});

test('external field memory is separate and only restored to that same field', async () => {
	const h = await setup({ preference: '1' });
	const search = { closest: () => null };
	h.focus(search); h.physical = '2'; await h.settle();
	const first = h.plugin.beginEnglishOverride('search');
	const second = h.plugin.beginEnglishOverride('nested');
	await second.ready;
	h.plugin.endEnglishOverride(first);
	h.plugin.endEnglishOverride(second); await h.settle();
	assert.equal(h.physical, '2');
	assert.equal(h.plugin.imStatus, 2);
	const owner = h.plugin.beginEnglishOverride('search'); await owner.ready;
	h.switchTo(h.makeView('normal'));
	h.plugin.endEnglishOverride(owner); await h.settle();
	assert.equal(h.physical, '1');
});

test('background editor events do not manipulate a different input field', async () => {
	const h = await setup();
	h.focus({ closest: () => null }); await h.settle();
	const before = h.calls.length;
	h.mode('normal'); await h.settle();
	assert.equal(h.calls.length, before);
	assert.equal(h.physical, '2');
});

test('blur cancels in-flight helper and no commands launch until focus returns', async () => {
	const h = await setup();
	h.mode('normal'); await h.settle();
	h.hold = '-o'; h.mode('insert'); await h.settle();
	h.blur(); await h.settle();
	assert.equal(h.killed, 1);
	h.finish(); await h.settle();
	const before = h.calls.length;
	h.mode('normal'); await h.settle();
	assert.equal(h.calls.length, before);
	h.refocus(); await h.settle();
	assert.equal(h.physical, '1');
});

test('inactive override rejects readiness without invoking helper', async () => {
	const h = await setup(); h.blur(); await h.settle();
	const count = h.calls.length;
	const owner = h.plugin.beginEnglishOverride('inactive');
	await assert.rejects(owner.ready, /inactive/);
	h.plugin.endEnglishOverride(owner); await h.settle();
	assert.equal(h.calls.length, count);
});

test('old editor listeners detach on navigation and all registered listeners clean up', async () => {
	const h = await setup();
	const old = h.active;
	h.switchTo(h.makeView('normal')); await h.settle();
	assert.equal(h.modeEvents.filter(event => event.cm === old.cm).length, 0);
	assert.equal(h.modeEvents.length, 1);
	h.switchTo(null); await h.settle();
	assert.equal(h.modeEvents.length, 0);
	h.unload(); h.layoutReady(); await h.settle();
	assert.equal(h.listeners.length, 0);
	assert.equal(h.workspaceEvents.length, 0);
	assert.equal(h.plugin.disposed, true);
	assert.throws(() => h.plugin.beginEnglishOverride('late'), /unloaded/);
});

test('unload during preparation cancels helper and cannot apply late restoration', async () => {
	const h = await setup();
	h.hold = 'query';
	const owner = h.plugin.beginEnglishOverride('pending'); await h.settle();
	h.unload();
	await assert.rejects(owner.ready);
	h.finish(); await h.settle();
	assert.equal(h.killed, 1);
	assert.equal(h.plugin.englishOwners.size, 0);
	assert.equal(h.modeEvents.length, 0);
	assert.equal(h.physical, '2');
});

test('invalid status is visible, retains preference, forces Normal English and queue recovers', async () => {
	const h = await setup();
	h.physical = 'invalid'; h.mode('normal'); await h.settle();
	assert.equal(h.physical, '1');
	assert.equal(h.plugin.imStatus, 1);
	assert.ok(h.errors.length); assert.ok(h.notices.length);
	h.mode('insert'); await h.settle();
	assert.equal(h.physical, '2');
});

test('helper failure and timeout reject API readiness, sanitize paths, and permit recovery', async () => {
	for (const error of [{ code: 'ENOENT', message: 'C:\\PRIVATE\\helper.exe' }, { killed: true }]) {
		const h = await setup();
		h.fail = error;
		const owner = h.plugin.beginEnglishOverride('failure');
		await assert.rejects(owner.ready);
		h.plugin.endEnglishOverride(owner); await h.settle();
		assert.ok(h.errors.length); assert.ok(h.notices.length);
		assert.ok(!JSON.stringify(h.errors).includes('PRIVATE'));
		if (error.killed) assert.match(h.errors.join(''), /5000 ms/);
		const next = h.plugin.beginEnglishOverride('recovery'); await next.ready;
		assert.equal(h.physical, '1');
		h.plugin.endEnglishOverride(next); await h.settle();
		assert.equal(h.physical, '2');
	}
});

test('legacy push failure releases its owner', async () => {
	const h = await setup();
	h.fail = { code: 'ENOENT' };
	h.commands['push-im-status'](); await h.settle();
	assert.equal(h.plugin.englishOwners.size, 0);
	assert.equal(h.plugin.legacyOwners.length, 0);
});

test('no shell, Windows executable resolution, and argument arrays on every supported platform', async () => {
	for (const platform of ['win32', 'linux', 'darwin']) {
		const h = await setup({ platform });
		h.mode('normal'); await h.settle();
		assert.ok(h.calls.every(call => call.executable === (platform === 'win32' ?
			'C:\\helper path\\fcitx-remote.exe' : '/helper path/fcitx-remote')));
		assert.deepEqual(h.calls.at(-1).args, ['-c']);
		if (platform === 'win32') {
			h.plugin.settings.fcitxRemotePath_windows = 'C:\\helper path\\custom.EXE';
			h.mode('insert'); await h.settle();
			assert.equal(h.calls.at(-1).executable, 'C:\\helper path\\custom.EXE');
		}
	}
});

test('missing helper path and unsupported Vim bridge are explicit errors, not guessed modes', async () => {
	const h = await setup();
	h.plugin.settings.fcitxRemotePath_windows = '';
	h.mode('normal'); await h.settle();
	assert.ok(h.errors.length);
	const count = h.calls.length;
	delete h.active.cm.state.vim;
	h.focus(h.active.target); await h.settle();
	assert.equal(h.calls.length, count);
	assert.equal(h.plugin.context, null);
	assert.match(h.errors.join(''), /Vim bridge/);
});

test('Vim disabled does not use body mode switching', async () => {
	const h = await setup();
	h.vimEnabled = false;
	const count = h.calls.length;
	h.mode('normal'); await h.settle();
	assert.equal(h.calls.length, count);
});

test('diagnostics are opt-in, bounded, and contain no document or caller text', async () => {
	const h = await setup();
	assert.equal(h.logs.length, 0);
	h.commands['toggle-diagnostics']();
	const owner = h.plugin.beginEnglishOverride('PRIVATE-CALLER-TEXT'); await owner.ready;
	h.plugin.endEnglishOverride(owner); await h.settle();
	for (let i = 0; i < 600; i++) h.focus(h.active.target);
	await h.settle();
	assert.equal(h.plugin.debugRows.length, 500);
	assert.ok(!JSON.stringify(h.logs).includes('PRIVATE-CALLER-TEXT'));
	assert.ok(!JSON.stringify(h.logs).includes('helper path'));
	h.unload();
	assert.equal(h.plugin.debugRows.length, 0);
});

test('release metadata is consistent and bundle contains no local vault paths or source map', () => {
	const root = path.join(__dirname, '..');
	const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')));
	const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
	const versions = JSON.parse(fs.readFileSync(path.join(root, 'versions.json')));
	assert.equal(manifest.id, 'vim-input-method-memory');
	assert.equal(manifest.name, 'Vim Input Method Memory');
	assert.equal(pkg.version, manifest.version);
	assert.equal(versions[manifest.version], manifest.minAppVersion);
	assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
	assert.ok(!/note_debug|syncthing|OneDrive|sourceMappingURL/.test(source));
	assert.ok(!fs.existsSync(path.join(root, 'fcitx-remote.exe')));
});
