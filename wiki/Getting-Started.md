# Getting started

## Install the .deb (Debian, Ubuntu, Linux Mint)

Download `nova-commander_<version>_amd64.deb` from the [Releases](https://github.com/FireFoxx150/nova-commander/releases) page, then run:

```bash
sudo apt install ./nova-commander_<version>_amd64.deb
```

The package installs to `/opt/nova-commander`, adds a menu entry, and creates the `nova-commander` command.

It recommends these packages, which add optional features:

- `7zip` or `p7zip-full`: archive editing and extraction
- `zstd`: `.tar.zst` archives
- `ffmpegthumbnailer`: video thumbnails
- `rclone` and `fuse3`: cloud accounts ([Cloud and MEGA](Cloud-and-MEGA))

## Install the Flatpak

The Flatpak needs the `org.freedesktop.Platform` and `Sdk` 26.08 runtimes from Flathub. It runs Electron inside the zypak sandbox wrapper. Cloud accounts don't work in the Flatpak, because it can't mount FUSE filesystems.

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

The package is written to `dist/`. The version comes from `package.json`. Bump it before each rebuild, so the new package is not treated as the one already installed. See [Packaging and releases](Packaging-and-Releases).

## Your data

Settings, favourites, saved windows, tab sets, tags, user themes and plugins are stored in your user config folder, `~/.config/Nova Commander/`. Put a file named `portable` next to the program to keep this data in a `data` folder beside it instead (see [Settings](Settings)).
