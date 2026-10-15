# Nova Commander — feature checklist

Features One Commander 3.108 exposes, derived from its shipped UI metadata
(view names and English UI strings only — no code was decompiled or copied).
Status reflects Nova Commander 1.3.1.

Legend: `[x]` done · `[~]` partial · `[ ]` missing · **P1/P2/P3** = suggested priority.
Windows-only items with no Linux meaning are listed at the end and skipped.

## Browsing & layout
- [x] Columns (Miller) view
- [x] Details / list view
- [x] Thumbnail view (Ctrl+3): image thumbnails, big icons, keyboard grid navigation, Ctrl+wheel / Settings to resize
- [x] Dual pane, resizable divider
- [x] Pane layout: side by side or above each other (Settings, pane menu)
- [x] Tabs per pane
- [x] Reopen closed tab (Ctrl+Shift+T), close other tabs, close tabs to the right, duplicate tab — tab right-click menu
- [x] Close tabs unused for an hour (tab / pane menu)
- [x] Tab aliases: double-click or right-click a tab to rename; optional "keep name when the folder changes"
- [x] Restore last used tabs (paths, views, sort, aliases) on start
- [x] Multiple windows (Ctrl+N), saved window layouts; settings stay in sync between windows
- [x] Breadcrumbs + editable path bar
- [x] Path bar autocomplete: subfolders as you type, recent + favorite folders; ↑↓ / Tab / Enter
- [x] Back / forward / up history
- [x] Recent folders in the sidebar (count configurable, clear / remove entries)
- [x] Parent column width setting
- [x] Parent columns widen to fit long names while the mouse rests on them (Settings → Appearance)

## Sidebar
- [x] Places / drives with free space
- [x] Favorites (add / remove)
- [x] Favorite groups (new / rename / reorder / delete), aliases, drag to rearrange or move between groups, drop folders on a group to add
- [x] Collapsible sidebar sections; hide the Drives section

## File list
- [x] Colour-coded file age column
- [x] Sort by name / ext / date / size
- [x] Sort by colour tag (pane / background menu)
- [x] Sort by date created
- [x] Sort by date taken / resolution (read from photo headers)
- [x] Length column and sort by length for audio/video the built-in player understands (no ffprobe needed)
- [x] "Keep folders above files" setting; natural-number sort
- [x] Filter-as-you-type
- [x] Filter by type (folders / images / videos / audio / documents / archives / code)
- [x] Folder sizes (async)
- [x] Show hidden files toggle
- [x] Show/hide file extensions; "Also treat as hidden" patterns
- [x] Colour tags: 7 colours, Alt+1…7 toggle / Alt+0 clear, swatch row in context menus, row stripe + tint, shown in preview; stored in `~/.config/Nova Commander/tags.json` and kept in sync through rename / move / batch rename / trash
- [x] Sidebar Tags section with counts; click to list everything with that colour
- [x] Highlight files changed in the last hour
- [x] Summary row (status bar: item count, selection count and size)
- [x] Choose list columns: Ext, Age, Modified, Created, Taken, Dimensions, Tag, Size

## File operations
- [x] Copy / cut / paste, system clipboard interop
- [x] Move / copy to other pane (F6 / Shift+F6)
- [x] Drag & drop with spring-loading
- [x] Conflict dialog (skip / replace / keep both)
- [x] Duplicate
- [x] Rename (F2)
- [x] Trash / permanent delete
- [x] Undo
- [x] New folder / new text file
- [x] Operation queue ("Taskmaster"): transfers run one at a time with byte progress, speed, time left, pause / resume / cancel (partial copies removed)
- [x] Batch rename (F2 on a multi-selection, Ctrl+F2 for one): find/replace or regex with $1 groups, tokens {name} {ext} {n} {n:3} {date} {parent}, case change, include-extension toggle, live preview with conflict checks, safe swaps, undo
- [x] Archives via system 7z / tar / zstd: extract here (unwraps a single top-level item), extract to folder, password prompt, compress to .zip in one click or zip / 7z / tar.gz / tar.xz / tar.zst / tar with optional password, progress + cancel, archive browser dialog
- [x] Archive browser: open folders inside the archive, extract only selected entries
- [x] New folder with selection
- [x] File templates from `~/Templates`: "New <template>" in the background menu, "Save as template"
- [x] Symbolic / hard links (menu, or Ctrl+Shift while dropping)
- [x] Drop List shelf: collect items from many folders (Alt+D, menu or drag), copy/move them all into the current folder, drag them back out
- [x] Copy to… (F7) / Move to… (Shift+F7) with recent destinations, the other pane and favourites
- [x] New tab from clipboard path (Ctrl+Shift+V)

## Preview & info
- [x] Image / video / audio / PDF / text preview
- [x] Folder info (counts)
- [x] Image / video dimensions and media duration in the preview
- [~] Codec / bit rate / sample rate in the preview — shown when ffprobe is installed (not installed here, so untested)
- [x] Photo EXIF (built-in JPEG parser): date taken, camera, aperture, shutter, ISO, focal length, GPS with OpenStreetMap link
- [x] Office / RTF preview (LibreOffice → PDF, cached) and .eml e-mail preview
- [x] Outlook .msg preview (built-in reader: sender, recipients, subject, date, body)
- [x] Font preview (preview panel and Quick Look)
- [x] Quick Look (Space): large preview inside the window, ← → to step through
- [x] Thumbnail cache for large images (Settings: size + clear)

## Search
- [x] Recursive search (Ctrl+Shift+F or toolbar button): names with substring / * ? wildcards / regex, match case, search inside text files, include hidden; streams results, stop, sort columns, keyboard nav, drag out, context menu, locate in folder; skips /proc /sys /dev /run

## Customisation
- [x] Themes (switcher)
- [x] Accent colour picker (Cinnamon has no system accent API to follow)
- [x] Settings window (Ctrl+,): folders first, extensions, date format, hidden patterns, confirm trash, recent folders, tab names, theme, accent, row height, text size, thumbnail size
- [x] Keyboard shortcut editor: every command rebindable, clash handling, reset
- [x] Icon packs: any installed icon theme (Papirus, Mint-L, Adwaita, …)
- [x] Folder background images (right-click an image → Use as folder background)
- [x] Global shortcut to show/hide Nova
- [~] Tray icon + keep running in background (built; not exercised by the tests so it wouldn't appear on your panel)

## Tools & integration
- [x] Open terminal here
- [x] Reveal in system file manager
- [x] Copy path
- [x] "Open with…" chooser from desktop entries (suggested by MIME type, plus all file-accepting apps), optional "always use"
- [x] Folder watcher (auto-refresh of every visible column)
- [x] Scripts menu: executables in ~/.config/Nova Commander/scripts get the selection as arguments
- [x] Batch image convert / resize / watermark (JPEG, PNG, WebP; built in)
- [x] File Automator: rules (pattern, age) → move / copy / tag / rename / trash, with preview
- [x] Folder notes shown at the top of the folder
- [~] Network: Connect to server (smb/sftp/ftp/dav), find servers, list shares, unmount — only the error path could be tested here (no servers on your network answered)
- [~] Phones (MTP) appear under Network & devices when connected — untested (no phone attached)
- [x] Run / Run with parameters for executables
- [~] Run as administrator (pkexec) — untested because it opens a password prompt
- [x] Set Nova as the default file manager (Settings → General); folders opened from other apps open in a new tab

## Skipped (Windows-only)
Microsoft Store licensing, Mica/Acrylic window effects, Windows shell context
menu, Recycle Bin via Explorer, drive-letter mapping, Windows thumbnail cache,
"Photos workaround", taskbar grouping, open/save dialog connector.

## Suggested next steps
1. ~~**P1 batch:** colour tags · reopen closed tab · batch rename · archives · search~~ — done
2. ~~**P2 batch:** grid view · settings window · favorite groups · history pane · Drop List · operation queue~~ — done
3. ~~**P3 batch**~~ — done; remaining open items are marked above
