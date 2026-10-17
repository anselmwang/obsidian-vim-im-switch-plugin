# Changelog

## 1.1.0 - Vim Input Method Memory

First release prepared under the distinct `vim-input-method-memory` identity.
Based on upstream TypeScript 1.0.8 with its code and third-party MIT attribution
preserved. Maintained by anselmwang.

### Highlights / 主要优势

- **Less Windows switching overhead:** shell-free calls avoid the old observed
  shell-startup delay; actual speed still depends on the helper and OS.
  **减少 Windows 切换开销：**避开已观察到的 shell 启动延迟，不作通用提速保证。
- **Remember either input preference:** Chinese or English text entry is kept
  separate from temporary English command modes.
  **中英文偏好都能记住：**正文偏好与命令模式的临时英文分开保存。
- **Opt-in plugin cooperation:** supports integrations such as Key Sequence
  2.1.0, while also working standalone.
  **可与其他插件协作：**支持 Key Sequence 等主动集成，也可独立使用。
- **Context-aware return:** cancelling a menu or jumping notes does not let a
  delayed callback restore Chinese into Normal mode.
  **返回状态更合理：**取消菜单、跳转笔记后按当前模式恢复，避免 Normal 误切中文。
- **More predictable switching and visible errors:** scoped ownership and queued
  operations handle stale callbacks; failures/timeouts are surfaced.
  **切换更可控、错误可见：**处理过期回调，并提示 helper 失败和超时。

### Changes

- Keep Insert/Replace input preference separate from temporary English.
- Keep focused Normal/Visual and cooperating menus in English; note jumps no
  longer restore Chinese into Normal mode.
- Remember manual English as well as active input method preference.
- Add synchronous scoped `beginEnglishOverride(reason)` / `owner.ready`,
  idempotent `endEnglishOverride(owner)` and `disposed` for cooperating plugins.
- Serialize helper work and reconcile stale completions with the latest mode.
- Detach old editor listeners and register workspace/DOM cleanup.
- Reject invalid helper output and surface command failures and 5-second timeouts.
- Use shell-free `execFile`, Windows `.exe` resolution and explicit arguments.
- Stop launching helper commands when unfocused; cancel running helpers on
  window blur/unload where possible. Already-executing foreground-only helpers
  retain a documented focus-race limitation.
- Replace private diagnostics with opt-in, bounded, text-free metadata.
- Add strict TypeScript checks, deterministic bundle regression tests and CI.

### Migration and compatibility

Install separately and disable the old plugin first. Configure your own trusted
external helper; no executable or private settings are included. Minimum
Obsidian version is conservatively 1.14.4; CM5, mobile and detached windows are
not claimed supported. Linux/macOS real input methods remain untested.

The version advances upstream 1.0.8 to 1.1.0 for new behavior and the cooperating
plugin API without reusing an upstream tag. The obsolete upstream package
version (0.12.0) is aligned with the manifest. Historical versions.json entries
remain as provenance, not as releases of the new plugin ID.

Publishing is gated on cross-plugin integration and maintainer review. Community
directory eligibility for a fork is a separate gate from a GitHub release.
