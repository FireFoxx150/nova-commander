# Architecture

Nova Commander is an Electron app with three parts.

## Processes

- **Main process** (`main.js`): owns the file system. It runs every operation that touches disk, network or other programs: listing and watching folders, copying and moving, the operations queue, archives through 7-Zip, search, thumbnails, the terminal, cloud mounts, git status, and plugins and scripts.
- **Preload** (`preload.js`): runs in a privileged context and exposes one object, `window.api`, through Electron's `contextBridge`. It lists each allowed call by name. The page can't reach `ipcRenderer` directly.
- **Renderer** (`renderer/`): the interface. It holds no file system access. Everything it needs comes through `window.api`.

## Security settings

The window is created with:

- `contextIsolation: true`
- `sandbox: true`
- `nodeIntegration: false`
- a Content Security Policy that allows scripts only from the app itself (`script-src 'self'`)
- new windows are denied, and in-page navigation is blocked

The Chromium sandbox helper, `chrome-sandbox`, must be setuid root in the `.deb`. The postinstall script sets this.

## IPC channels

Calls from the renderer go through `ipcRenderer.invoke` and return a result. Messages the main process pushes to the page come through `ipcRenderer.on`. The names are grouped by prefix:

| Prefix | Covers |
|---|---|
| `fs:` | listing, stats, rename, copy and move, trash and delete, search results, previews, checksums, duplicates, sync, permissions, links, text editing |
| `arc:` | archive listing, extraction, compression and editing |
| `search:` | recursive search, streamed back in batches |
| `thumb:` | the thumbnail cache, and video frame thumbnails |
| `term:` | the terminal panel: start, input, data and exit |
| `cloud:` | rclone accounts: status, mount, unmount, uploads |
| `net:` | network shares: mounts, connect, scan |
| `scripts:` and `plugins:` | the Scripts menu and plugins |
| `themes:` | user themes |
| `sys:` | places, apps, default file manager, opening maps and files |
| `tags:` | colour tags |
| `icons:` | icon themes |
| `win:` and `app:` | window controls, tray, global hotkey |

The full list is in `preload.js`.

## Renderer structure

- `renderer/app.js` holds the state, the panes, the list and thumbnail rendering, keyboard handling, drag and drop, the sidebar, settings, and the command table (`ACTIONS`).
- `renderer/tools.js` holds the dialogs and tools. Functions there are plain globals, shared with `app.js` because the page loads the scripts one after another. Names must be unique across both files: a duplicate name silently replaces the earlier one.
- Settings are saved to the config folder through `saveState()`. Shared settings sync between windows through `SHARED_KEYS`.

## Rendering

Panes redraw by rebuilding HTML for the list body, the tabs and the toolbar (`renderPane`). Background results that arrive later, such as folder sizes, git status and metadata, call `renderBody` again. Rows are found by `data-path`, and folders that accept drops carry `data-drop`.

## Data files

| File | Location |
|---|---|
| Settings, favourites, saved windows, tab sets, recents | `~/.config/Nova Commander/` (state storage) |
| Thumbnail cache | the app's cache folder |
| Tags | `tags.json` in the config folder |
| User themes | `themes/` in the config folder |
| Plugins | `plugins/` in the config folder |
| Scripts | `scripts/` in the config folder |

## Terminal

The terminal runs `pty-helper.py`, a small Python script that opens a pseudo-terminal and starts your shell in it. The renderer draws the output with xterm.js. Python is needed on the system for the terminal panel.
