# Using Nova Commander

## Panes

Nova has one pane, or two side by side (Ctrl+D). Each pane has its own tabs, view, zoom and scroll position. The active pane has a highlighted border. Click a pane to make it active, or press Tab to switch.

The sidebar lists drives, places, favourites, network shares, cloud accounts, MEGA, your recent folders, and the Drop List. The bottom bar has the settings, theme, hidden-files, dual-pane, preview, terminal, undo and operations buttons. You can hide any of them, and add commands of your own, in Settings.

## Views

Each tab has one of three views:

- **Columns** (Ctrl+1): Miller columns. Each folder opens in a new column to the right, so you can see the path.
- **List** (Ctrl+2): details with sortable columns, file age, size bars, and git badges in git repositories.
- **Thumbnails** (Ctrl+3): a grid of images and video frames. Ctrl + mouse wheel changes the thumbnail size.

Set the view for new folders in Settings.

## Tabs

Ctrl+T opens a tab, and Ctrl+W closes one. Ctrl+Shift+T reopens the last closed tab. Middle-click a sidebar entry to open it in a new tab. Right-click a tab to rename it, duplicate it or close the others. Tabs unused for an hour can be closed in one go.

**Tab sets** save every tab in both panes under a name, so you can reopen them later in the current window. Use the right-click menu, then Tab sets.

**Saved windows** save the layout and open it in a new window.

## Drag and drop

- Drag files onto a folder to **move** them. Hold **Ctrl** to copy, or Ctrl+Shift to create links.
- You can drop onto a folder row, a tab, the pane's current-folder bar, a sidebar place, a favourite, or the Drop List.
- Drop onto the other pane's folder bar to move between panes.
- Drag from the Drop List to collect files from several folders first.

Dragging over a folder doesn't open it by default. Turn on "Open a folder when a drag rests on it" in Settings if you want that.

## File operations

Copy, move, delete and rename run in a queue. The bottom bar shows the current job with pause and cancel. Replacing a file moves the old copy to the Trash, not into nothing. Ctrl+Z undoes moves, copies, renames and new files.

Delete moves to the Trash (Delete). Shift+Delete removes permanently after a confirmation.

Batch rename (F2 with several items selected, or Ctrl+F2) takes a template with `{name}`, `{n}`, `{date}` and similar tokens, or a regular expression with `$1` captures.

## Search

Ctrl+Shift+F searches the folder and everything below it. The search bar has options for case, regular expressions, text inside files, hidden files, a size filter (over 1 MB to over 1 GB) and a modified-time filter (last day to last year).

Ctrl+F filters the current folder by name. Right-click the filter box to save a filter under a name.

## Files and folders

- **Properties** (Alt+Enter): size, dates, the Permissions tab, and folder size.
- **Checksums** (MD5 and SHA-256) and **Find duplicates** are in the right-click menu.
- **Compare with other pane** (Ctrl+Alt+M) highlights the differences between two folders.
- **Sync this folder to other pane** makes one folder match the other, after a preview. Anything replaced or removed goes to the Trash.
- **Colour tags**: Alt+1 to Alt+7 sets a tag, and Alt+0 clears it.
- **Folder notes**, and a **To-do list** per folder.
- **Quick Look** (Space), **View file** (F3), **Edit file** (F4), and **Compare two files** (Ctrl+Alt+D) for text files.

## Archives

Nova opens zip, 7z, and tar archives (gzip, bzip2, xz, zstd) like folders. You can extract, add files to an archive, and delete entries. Archive operations need 7-Zip (`7zz`, `7z` or `7za`).

## Terminal panel

Ctrl+` opens a terminal under the panes. "Current folder" moves it to the folder you're in. The shell is your login shell unless you set one in Settings → Terminal.

## Preview panel

Ctrl+P shows details for the selected item: a preview of images, video, PDF, text (the first 64 KB by default), and photo information such as the camera and the date taken. Email files (`.eml`, `.msg`) show their headers and text.

## Other

- **Connect to server** mounts SMB, SFTP, FTP and WebDAV shares.
- **Scripts** and **plugins** appear in the right-click menu when they fit the selected files. See [Plugins and scripts](Plugins-and-Scripts).
- **Image tools**: convert and resize images with the File Automator and the image dialog.
- **Global hotkey**: set one in Settings to show Nova from anywhere.
- **Keep in tray**: the window can go to the system tray instead of closing.
