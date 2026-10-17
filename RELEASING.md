# Releasing

## Current preparation: 1.1.0

Do not publish before the coordinated Key Sequence integration gate passes.
The implementation PR is ready for review, not permission to merge or tag.

1. Review and merge the tested PR into this fork's default branch only after
   the integration gate. Do not push changes or release requests to upstream.
2. From the reviewed commit, run `npm ci` and `npm test` with Node.js 22.
3. Confirm `manifest.json` ID `vim-input-method-memory`, name
   `Vim Input Method Memory`, version `1.1.0` and minimum Obsidian `1.14.4`.
   Confirm the package version and versions.json mapping match.
4. Validate the actual paired release bundles in the isolated test vault:
   both Chinese and English preferences; Insert/Replace/Normal/Visual;
   menu cancellation; `phw` and other note jumps; focus changes; plugin unload.
   Installation/reload of that vault belongs to the coordinating maintainer.
5. Create tag **`1.1.0`** at the reviewed commit, without a `v` prefix, then a
   GitHub release in `anselmwang/obsidian-vim-im-switch-plugin`.
6. Attach **`main.js`** and **`manifest.json`** from that exact build. No
   stylesheet is used. Do not attach settings, helper executables, source maps,
   private paths or test-vault files. The full MIT notice is embedded in main.js.
7. Use the 1.1.0 changelog section as release notes, including migration,
   external-helper requirements and the explicit platform/focus limitations.
8. Re-download the assets and compare hashes before announcing availability.

CI builds and uploads the two plugin assets for review but never tags, merges,
publishes releases or installs into a vault.

## Community directory: separate eligibility and account gate

Follow the current official
[submission guide](https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin)
and [developer policies](https://docs.obsidian.md/Developer+policies).

The directory is **community.obsidian.md**. The maintainer signs in with an
Obsidian account, links the GitHub account that owns the repository, and adds the
plugin there. It processes the manifest on the repository's default branch;
that version needs a matching GitHub release and uploaded plugin assets.
Do not substitute the historical community-plugins.json PR workflow.

The current fork policy requires publicly verifiable explicit original-author
approval, or its stated inactive/unreachable-author contact and waiting process
(including the 30-day acknowledgment window where applicable). An MIT license,
an archived upstream repository or old merged contribution PRs alone do not
prove directory eligibility. The maintainer coordinates this gate; no author
approval or listing acceptance is claimed by this release preparation.

## Evidence boundaries

The controlled tests execute the actual built bundle with simulated Obsidian
DOM/workspace events and helper completion timing. They verify emitted calls,
memory, ownership and lifecycle behavior; they do not verify Windows IME
conversion, system indicators, Linux/Wayland behavior or macOS input sources.
The starting local implementation was observed on Windows with Obsidian 1.14.4.
That is not a substitute for validating these new release assets.
