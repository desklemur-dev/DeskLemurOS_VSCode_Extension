# Publishing DeskLemurOS Agents

The extension ships with DeskLemurOS (Settings › System › Coding tools installs it). These steps publish it to the
VS Code Marketplace and to Open VSX (VSCodium, Cursor and the like). This file is not part of the package.

This folder is its own repository (https://github.com/desklemur-dev/DeskLemurOS_VSCode_Extension). In the DeskLemurOS
checkout it sits at `vscode_extension/`, beside `browser_extension/` (the Chrome extension's repository); the app's
release build ships it as `integrations/vscode`, without `.git`, `dist`, tests or this file.

Publisher: `DeskLemurOS-DEV` (package.json writes it `desklemuros-dev`; ids ignore case) · Extension id:
`desklemuros-dev.desklemuros-agents` · License: MIT OR Apache-2.0

## Once

1. **Marketplace publisher**: sign in at https://marketplace.visualstudio.com/manage with a Microsoft account and
   create the publisher (done 2026-10-16: `DeskLemurOS-DEV`; it matches `publisher` in package.json, ignoring case).
2. **Token**: in Azure DevOps (https://dev.azure.com, any organization), create a Personal Access Token with
   *Organization: All accessible organizations* and the scope *Marketplace › Manage*.
3. **Open VSX** (optional): sign in at https://open-vsx.org with GitHub, sign the publisher agreement and create the
   namespace `desklemuros-dev` there.
4. **Repository**: create https://github.com/desklemur-dev/DeskLemurOS_VSCode_Extension (package.json and the
   Marketplace listing link to it) and push this folder (`origin` is set to it).

## Each release

1. Raise `version` in package.json and add it to CHANGELOG.md.
2. Package and check, from the DeskLemurOS checkout:
   `python3 scripts/vscode_extension_publisher/publish.py --package`. It checks package.json, the changelog entry and
   the tests, then writes `vscode_extension/dist/<name>-<version>.vsix` and checks that it is flagged `Public` (0.3.0
   went up as Private without that flag). `npx @vscode/vsce package` in this folder works too.
3. Push the source: `python3 scripts/vscode_extension_publisher/publish.py --push -m "…"` (as desklemur-dev).
4. Publish:
   - Marketplace: `npx @vscode/vsce publish -p <token>`, or upload the .vsix at the publisher page.
     `--pre-release` publishes to the pre-release channel first.
   - Open VSX: upload the same .vsix on open-vsx.org (its `ovsx` command line is EPL-2.0, outside the permissive-only
     rule, so it is not used here).

The extension uses stable VS Code APIs only (`lm.registerLanguageModelChatProvider`,
`lm.registerMcpServerDefinitionProvider`), so the Marketplace accepts it. It talks only to DeskLemurOS on this
computer (`desklemuros.endpoint`) and sends no telemetry. `vsce` (MIT) is only run with npx when publishing; nothing
shipped depends on it.

## The app and the Marketplace copy

Listing: https://marketplace.visualstudio.com/items?itemName=DeskLemurOS-DEV.desklemuros-agents (publisher id
DeskLemurOS-DEV; ids ignore case, so package.json's `desklemuros-dev` is the same publisher). Settings and Setup link to it
(core/vscode_extension.MARKETPLACE_URL).

Settings > System > Coding tools and Easy Setup install the copy the app carries (a .vsix built from this folder,
same id `desklemuros-dev.desklemuros-agents`). VS Code does not auto-update a .vsix install, so that copy stays at
the app's version until the app ships a newer one. A copy installed from the Marketplace is kept up to date by VS
Code and can be newer than the app's; Settings shows it as kept and never offers to go back to the app's
(core/vscode_extension.install_state). So a published version must keep working with the app versions already out:
add to the app's API, do not change what an older app answers.
