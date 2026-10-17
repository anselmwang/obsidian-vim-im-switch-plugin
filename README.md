# Vim Input Method Memory

Remember the input method you use for Vim text entry, independently of temporary English command modes.

This desktop-only Obsidian plugin is a maintained TypeScript fork of [Yuan Chen's Vim Input Method Switch](https://github.com/yuanotes/obsidian-vim-im-switch-plugin), based on upstream **1.0.8**, maintained by **anselmwang**. It retains the upstream code and third-party MIT attribution. The new plugin ID is **`vim-input-method-memory`**; it is a separate installation, not an automatic update of the old plugin.

## Why use this fork?

- **Less switching overhead on Windows:** direct helper calls avoid the shell-startup lag observed with the old shell-based implementation. Actual speed depends on your helper and OS; this is not a universal or quantified speed guarantee.
- **Remember Chinese or English while typing:** Insert/Replace restores your remembered body-entry preference; Normal/Visual uses English without overwriting that preference.
- **Work with other plugins:** opt-in integrations such as Key Sequence 2.1.0 can temporarily request English. Vim Input Method Memory also works independently.
- **Return to the right input mode:** cancelling a menu or jumping to another note uses the current context, rather than a delayed callback restoring Chinese into Normal mode.
- **Fewer stale changes, clearer failures:** queued operations and scoped menu ownership prevent old callbacks from winning; helper failures/timeouts are reported, with optional diagnostics for troubleshooting.

See [Behavior](#behavior), [integration](#key-sequence-and-other-integrations) and [platform limits](#platform-support-and-limits) below, including the remaining focus-race limits of external helpers.

### 相比原版的主要优势

- **减少 Windows 切换开销：**直接调用 helper，避开旧版 shell 启动造成的已观察到的延迟；实际速度取决于 helper 和系统，不承诺所有平台都更快，也没有通用的量化提速保证。
- **中英文偏好都能记住：**Insert/Replace 恢复正文输入偏好，Normal/Visual 临时使用英文，不会把临时英文误记为正文偏好。
- **可与其他插件协作：**例如 Key Sequence 2.1.0 可以按需临时请求英文；本插件也能独立使用，不依赖快捷键插件。
- **菜单关闭、笔记跳转后状态更合理：**按当前编辑模式决定是否恢复输入法，避免延迟回调把 Normal 模式误切回中文。
- **减少过期切换，错误可见：**串行操作和独立菜单所有权避免旧回调覆盖新状态；helper 失败、超时会提示，并可按需开启诊断。

具体行为及外部 helper 仍存在的焦点竞争限制，请参阅下文。

## Behavior

| Context | Input method |
| --- | --- |
| Focused note in Normal or Visual | English / input method deactivated |
| Note in Insert or Replace | Last remembered text-entry preference |
| Cooperating command menu, including Key Sequence integration | Temporary English |
| Menu closes into Normal, including a note jump | Remains English |
| Menu closes into Insert or Replace | Restores the text-entry preference |
| Search field or other non-editor control | Left alone, unless a cooperating menu explicitly requests English |
| Obsidian window is unfocused | No new helper calls; an in-flight helper is cancelled where possible |

The preference can be **English or Chinese** (more generally, inactive or active input method). Manually selecting English while typing is remembered when leaving a settled Insert/Replace mode or opening a cooperating menu. Temporary English does not overwrite that preference. This is one in-memory text-entry preference shared across notes, not one setting per note or per language, and it resets when the plugin reloads. The initial preference is sampled on first focused text entry; starting in Normal forces English and cannot recover a preference from a previous session.

Calls are serialized. Delayed work is reconciled against the latest mode rather than blindly restoring Chinese after a note jump. Menu owners are scoped: an old menu cannot release a newer menu's override.

## Setup

1. Use desktop Obsidian **1.14.4 or newer**, and enable **Settings → Editor → Vim key bindings**. The minimum is deliberately conservative: the local behavior and CM6 bridge were observed on 1.14.4, not validated on all older releases.
2. Install a **trusted `fcitx-remote`-compatible helper yourself**. This plugin does not download, install, update, or bundle a helper.
3. Install the plugin files from this fork's release into your vault's `.obsidian/plugins/vim-input-method-memory/` directory: `main.js` and `manifest.json`. No stylesheet is needed. Enable the plugin in Community plugins.
4. Set the appropriate platform's **Input method helper** setting to the executable path. Use the path alone, **without quotes or arguments**, even if it contains spaces. On Windows, an extensionless path gets `.exe` appended. The Windows default is deliberately empty.
5. Start in Insert mode, select your preferred input method, press Escape, and return to Insert. Verify both the actual text conversion and the mode indicator with your helper.

Disable the original **Vim Input Method Switch** before enabling this fork: two active controllers can fight over the same input method. Helper paths are not copied from the old plugin automatically. Re-enter the path in the new settings; do not copy someone else's machine-specific `data.json`. Do not use this plugin to replace the shared helper executable.

### Required helper protocol

| Invocation | Meaning |
| --- | --- |
| No arguments, stdout `1` | English / deactivated (`Deactivate`, internal enum value `2`) |
| No arguments, stdout `2` | Active input method (`Activate`, internal enum value `1`) |
| `-c` | Switch to English / deactivate |
| `-o` | Activate the input method |

Whitespace around query output is allowed. Other output (including `0`), a nonzero exit, a missing executable, or a timeout is an error, not an English default. Each helper process has a **5-second timeout**, a **64 KiB output limit**, an argument array, and **no shell** on any platform. Commands such as `im-select`, shell aliases, pipelines and wrapper command strings are not interchangeable with this protocol.

### Platform support and limits

- **Windows:** uses `execFile` with a hidden process window and `.exe` resolution. The predecessor's local behavior was exercised with a compatible helper and Obsidian 1.14.4. This release's automated tests simulate helper responses; they do not certify all Windows IMEs or this release's live integration. The historical [`fcitx-remote.ahk`](fcitx-remote.ahk) source is retained for provenance, not installed or compiled automatically; audit helper behavior and licensing independently. No compiled helper is distributed here.
- **Linux:** expects a separately installed, working `fcitx-remote`, typically provided by your distribution's Fcitx package. A compatible Fcitx5 helper may work if it implements the protocol above. No live Linux/X11/Wayland validation has been performed for this release.
- **macOS:** requires a compatible external helper, such as a separately evaluated [fcitx-remote-for-osx](https://github.com/xcodebuild/fcitx-remote-for-osx). macOS input source behavior depends on the helper. No live macOS validation has been performed for this release.

Obsidian's CM6 Vim bridge is an internal API. Both `editMode.editor.cm.cm` and `sourceMode.cmEditor.cm.cm` are checked, and actual `vim.insertMode`, `vim.visualMode` and `state.overwrite` flags determine the mode. Future Obsidian changes may require an update. Legacy CM5, mobile, embedded editors and detached/pop-out windows are not supported or claimed as tested.

The plugin does not launch commands while its main window is unfocused, and it attempts to kill its own running helper on blur/unload. **A foreground-only external helper already executing can still race a focus change before cancellation reaches it.** Absolute cross-application isolation requires a helper that safely targets and verifies a specific window; this protocol does not provide that guarantee. A successful process exit is not proof that the OS switched the actual input method.

Focus loss and unrelated text controls are not opportunities to query another application's or field's state. A manual preference not sampled before leaving the editor can therefore be lost. No continuous polling is used.

## Key Sequence and other integrations

The plugin works on its own and has no Key Sequence dependency. Cooperating plugins can look up the instance under **`vim-input-method-memory`**, capability-check it, and use:

```ts
interface EnglishOverride {
  readonly ready: Promise<void>;
}

interface InputMethodMemory {
  readonly disposed: boolean;
  beginEnglishOverride(reason: string): EnglishOverride;
  endEnglishOverride(owner: EnglishOverride): void;
}
```

`beginEnglishOverride` returns synchronously. Call it **before moving focus into the menu**, await `owner.ready`, then open/dispatch. Retain that exact owner through menu close and command dispatch; release in cleanup, on errors, cancellation and consumer unload. `ready` can reject if the helper fails, the window loses focus, or the plugin unloads during work. A released/unloaded owner's completion is not permission to open a stale menu: consumers must also check their own cancellation flag and `disposed` after awaiting.

```ts
const owner = memory.beginEnglishOverride('key-sequence');
try {
  await owner.ready;
  if (memory.disposed || cancelled) return;
  await runMenuAndCommand();
} finally {
  memory.endEnglishOverride(owner);
}
```

Owners are opaque, instance-specific objects. Releasing the same owner more than once, or passing an unknown owner, has no effect. Only the last release permits restoration, and the current focus/mode is recomputed then. A menu from an unrelated field restores its separate captured state only if that exact field regains focus. The caller-supplied `reason` is not logged.

A consumer may retain a capability-checked fallback for the locally patched old ID `obsidian-vim-im-switch-plugin`. Unmodified upstream versions do **not** provide this API. Consumers should remain usable when neither plugin is available. The paired commands **Temporarily use English** / **Release temporary English** are retained for manual integrations; they have no default hotkeys and each push must be matched by a release.

## Privacy and diagnostics

This plugin executes the trusted executable you configure **outside the vault**, with your account's permissions, to read/change the OS input method. That helper has its own behavior and trust boundary. The plugin itself makes no network requests, reads no note content, and writes only its settings through Obsidian's plugin storage. Helper paths stay in local plugin settings and are not included in release artifacts.

Use **Toggle input method diagnostics** to enable temporary developer-console metadata (state revisions, operations and durations). Diagnostics are off by default, retain at most 500 metadata rows in memory, and never record note text, keystrokes, composition text, helper output, caller reasons or executable paths. Turning them off or unloading clears the in-memory rows; console entries already printed remain until the console is cleared. Errors are reported explicitly; repeated notices are rate-limited to avoid flooding the UI. No diagnostic files or telemetry are written.

## Development and releases

Use Node.js 22 and npm:

```sh
npm ci
npm test
npm run build
```

`npm test` typechecks, builds the actual CommonJS release bundle, then runs deterministic tests against controlled Obsidian events, focus and helper completions. Tests cover preference/mode/menu combinations, note jumps, nested owners, invalid output, timeouts, focus loss, lifecycle cleanup and stale async races. They do not invoke a real IME.

See [CHANGELOG.md](CHANGELOG.md) for release notes and [RELEASING.md](RELEASING.md) for the publication gates. The release tag must be exactly **`1.1.0`**, matching `manifest.json`, `package.json` and `versions.json` (no `v` prefix).

**Community-directory availability is not promised.** This is a fork: MIT permission to distribute code and Obsidian's separate fork-listing eligibility rules are not the same. The directory now uses [community.obsidian.md](https://community.obsidian.md), linked Obsidian/GitHub accounts, and its current review process—not a `community-plugins.json` pull request.

## Attribution

Original plugin: **Yuan Chen / yuanotes**, [upstream repository](https://github.com/yuanotes/obsidian-vim-im-switch-plugin). Maintained fork: **anselmwang**. The TypeScript baseline is upstream tag `1.0.8`, commit `6c64b885e7a610f7260dcf04dca3618e77202629`; its source includes earlier fixes contributed by anselmwang.

The upstream MIT license, including **Copyright (c) 2021 Michael Brenan**, is preserved verbatim in [LICENSE](LICENSE) (renamed from `LICENSE.txt`) and embedded in the release JavaScript. Historical assets and helper source remain in Git history; this fork does not claim authorship of them.

## 中文说明

本插件将正文 Insert/Replace 模式的中英文偏好，与 Normal/Visual、快捷命令菜单临时使用的英文状态分开保存。手动切到英文后，下一次退出输入模式会记住英文；菜单跳转到 Normal 模式的笔记时不会错误恢复中文。

新名称为 **Vim Input Method Memory**，新 ID 为 **`vim-input-method-memory`**。请先停用旧插件，再手动安装本插件，重新配置可信的外部 helper 路径。插件不附带、不自动安装 helper，不读取笔记内容，不联网；正文偏好仅保存在本次运行的内存中。退出 Obsidian 焦点后不会新发起输入法命令，但已经执行中的外部 helper 存在上面说明的焦点竞争限制。社区上架还需要满足 Obsidian 对 fork 的独立审核要求。
