# Packaging and releases

## Version numbers

The version lives in `package.json`. The `.deb` takes its version from there. Each release gets a new number, because apt treats a package with the same version as already installed, even if the files changed.

## Build the .deb

```bash
npm run build:deb
```

This runs `build/build-deb.sh`. It:

1. renders the icons from `icon.svg`
2. copies Electron from `node_modules` into `/opt/nova-commander`
3. copies the app's files into `resources/app`
4. adds the menu entry, the icons at each size, and the licence files
5. writes the Debian control file, with the dependencies and recommended packages
6. builds `dist/nova-commander_<version>_amd64.deb`

The package depends on GTK and the libraries Electron needs. It recommends `7zip`, `zstd`, `ffmpegthumbnailer`, `rclone` and `fuse3`.

## Build the Flatpak

The manifest is `flatpak/com.github.FireFoxx150.NovaCommander.yml`. It uses the `org.freedesktop.Platform` and `Sdk` runtimes, version 26.08, and builds zypak, which gives Electron its sandbox inside Flatpak. Build steps are in [Getting started](Getting-Started).

## Release steps

1. Bump the version in `package.json`.
2. Build the `.deb` and check that it contains the new code.
3. Commit the changes and the version bump.
4. Push `main`.
5. Create a GitHub release, tagged on that commit, with the `.deb` attached.

Pushing and publishing are public actions, so check the commit and the release notes before you publish.

## Flathub

The Flathub submission is a separate repository, and it pins the commit and the Electron archive by checksum. Update those pins when the app changes. Flathub's checker closes a submission whose checklist is incomplete, so fill in every item before reopening a pull request.
