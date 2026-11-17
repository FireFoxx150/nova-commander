# Nova Commander wiki

Nova Commander is a dark dual-pane file manager for Linux, built with Electron. Drag and drop moves files by default; hold Ctrl to copy.

## Pages

- [Getting started](Getting-Started): install, run from source, build the packages
- [Using Nova Commander](Using-Nova-Commander): panes, views, tabs, file operations, search, and the rest of the interface
- [Keyboard shortcuts](Keyboard-Shortcuts): every rebindable command and its default keys
- [Settings](Settings): what each option does
- [Plugins and scripts](Plugins-and-Scripts): add commands to the Scripts menu
- [Themes](Themes): the built-in themes and how to write your own
- [Cloud and MEGA](Cloud-and-MEGA): cloud accounts through rclone, and uploads to MEGA
- [Architecture](Architecture): how the processes and files fit together
- [Packaging and releases](Packaging-and-Releases): the `.deb`, the Flatpak, and the release steps

## Where things live

| Path | What it holds |
|---|---|
| `main.js` | The Electron main process: file system, archives, search, terminal, cloud, plugins |
| `preload.js` | The bridge: the only API the page can call (`window.api`) |
| `renderer/app.js` | The interface: panes, views, settings, keyboard, drag and drop |
| `renderer/tools.js` | Dialogs and tools: archives, terminal panel, cloud, tab sets, viewer and editor |
| `renderer/icons.js` | Built-in icons and icon-theme lookup |
| `renderer/styles.css` | Layout and themes |
| `renderer/vendor/` | xterm.js for the terminal panel (MIT, see `THIRD_PARTY_NOTICES.md`) |
| `pty-helper.py` | Starts the terminal shell in a pseudo-terminal |
| `build/` | The `.deb` build script and icon rendering |
| `flatpak/` | The Flatpak manifest, launcher, desktop file and metainfo |
| `themes/` | Example user themes |

## Licence

GPL-3.0-only. See `LICENSE`. Third-party notices are in `THIRD_PARTY_NOTICES.md`.
