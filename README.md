# Nova Commander

A modern dark dual-pane file manager for Linux, with a look inspired by One Commander.

Nova Commander is an independent project and is not affiliated with or endorsed by One Commander.

Drag and drop **moves** files by default. Hold **Ctrl** while dragging to copy.

## Features

- **Dual-pane layout** with a resizable divider, side by side or stacked
- **Three views** per pane: columns (Miller), list, and thumbnails
- **Tabs** in each pane, with restore on start
- **Colour-coded file ages**, folder sizes, and sortable columns
- **Drag to select**: drag a box across files in list or thumbnail view
- **Per-pane thumbnail zoom** and scroll bars on each pane's right edge
- **Thumbnails** for images and video frames (video needs `ffmpegthumbnailer`)
- **Preview panel** with file details, photo info and text preview
- **Properties dialog** with Basic and Permissions tabs (Alt+Enter)
- **Undo** for moves, copies, renames and new files (Ctrl+Z)
- **File operations bar**: one line at the bottom showing the current copy or move, with pause and cancel
- **Drive names** in the sidebar and tabs, with free-space bars
- **Favorites** and recent folders in the sidebar
- Three themes: Black, Nord and Midnight

## Install

Download `nova-commander_<version>_amd64.deb` from the
[Releases](https://github.com/FireFoxx150/nova-commander/releases) page, then run:

```bash
sudo apt install ./nova-commander_<version>_amd64.deb
```

The package installs to `/opt/nova-commander` and adds a menu entry. Start it from the menu or with `nova-commander`.

Optional: `ffmpegthumbnailer` (video thumbnails), `7zip` or `p7zip-full` (archives), `zstd`.

## Run from source

Requires Node.js 18 or newer.

```bash
git clone https://github.com/FireFoxx150/nova-commander.git
cd nova-commander
npm install
npm start
```

## Build the .deb

```bash
npm run build:deb
```

The package is written to `dist/`. The version comes from `package.json`. Bump it before rebuilding, or apt will treat the new package as already installed.

## Keyboard shortcuts

| Keys | Action |
|---|---|
| Arrow keys, Home, End | Move the cursor |
| Enter | Open folder or file |
| Backspace / Alt+← | Up one folder |
| Ctrl+D | Toggle dual pane |
| Ctrl+T / Ctrl+W | New tab / close tab |
| Ctrl+L | Type a path |
| Ctrl+X / Ctrl+C / Ctrl+V | Cut / copy / paste |
| F2 | Rename |
| Delete | Move to Trash |
| Shift+Delete | Delete permanently (asks first) |
| F6 / Shift+F6 | Move / copy to the other pane |
| Ctrl+Z | Undo |
| Ctrl+H | Show hidden files |
| Ctrl+P | Toggle preview panel |
| Alt+Enter | Properties |
| Ctrl+3 | Thumbnail view |

## Project layout

- `main.js`: the Electron main process (file operations, drives, thumbnails)
- `preload.js`: the bridge between the main process and the interface
- `renderer/`: the interface (`app.js`, `tools.js`, `icons.js`, `styles.css`, `index.html`)
- `build/`: packaging script and icon rendering
- `SECURITY.md`: security policy

## Licence

GNU General Public License v3.0 only. See [LICENSE](LICENSE).

Third-party licences (including the Lucide icon set) are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
