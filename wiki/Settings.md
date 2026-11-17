# Settings

Open with Ctrl+, or from the gear button in the bottom bar. Changes apply straight away and are saved.

## General

- **Keep folders above files** (on by default)
- **Show extensions**
- **Date format**: ISO, day-month-year, month-day-year, or your system locale
- **Size units**: KB of 1024 bytes, kB of 1000 bytes, or exact bytes
- **Default view** for newly opened folders: details, thumbnails, or columns
- **Text preview** length in KB (64 by default)
- **No thumbnails for**: a comma-separated list of extensions, such as `gif, svg`
- **Font**: any installed font name. Leave blank for the built-in font
- **Highlight files changed in the last hour**
- **Confirm before moving to the Trash**
- **Hidden patterns**: extra names treated as hidden, such as `*.tmp, __pycache__`
- **Keep tab name** when a folder is renamed
- **Show recent folders** in the sidebar, and how many to keep

## Appearance

- **Theme** (Black, Nord, Midnight, Light, or a user theme). See [Themes](Themes)
- **Accent colour**, or the theme's default
- **Row height**, **font size**, **thumbnail size**
- **Layout**: panes side by side or stacked
- **Icons**: Nova's built-in icons, or a freedesktop icon theme installed on your system
- **Widen a parent column** to fit long names while the mouse rests on it (on by default)
- **Shadow under thumbnails** (on by default). Turn it off if thumbnail view glitches while scrolling
- **Show the Drives section**, and **Show the Folders tree**

## Columns

Choose which columns the list view shows: extension, age, modified, changed, size, dimensions, date taken, and duration.

## Keyboard

Rebind any command. See [Keyboard shortcuts](Keyboard-Shortcuts).

## Toolbar

Commands shown as buttons at the bottom of the sidebar. Tick the ones you want.

## Bottom bar

Hide any of the built-in bottom-bar buttons.

## Terminal

- **Shell**: the full path of the shell the terminal panel starts. Leave blank for your login shell. An invalid path falls back to the login shell.

## Cloud

- **Cache per account** in GB (10 by default)
- **Mount cloud accounts read-only**

## Drag and drop

- **Open a folder when a drag rests on it** (off by default)

## Background

- **Keep in tray**: the window goes to the system tray instead of closing
- **Global hotkey**: an Electron accelerator such as `Control+Alt+E` that shows Nova from anywhere
- **Thumbnail cache**: caches thumbnails of large images, so thumbnail view is faster next time

## Portable mode

Put a file named `portable` next to the program (in `/opt/nova-commander/` for the `.deb`). Settings and other data are then kept in a `data` folder beside it. The folder must be writable, so portable mode is only useful for a copy in a folder you own.
