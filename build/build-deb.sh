#!/usr/bin/env bash
# Builds dist/nova-commander_<version>_amd64.deb using dpkg-deb (no extra tooling).
# Installs to /opt/nova-commander with a menu entry, icons and /usr/bin/nova-commander.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

NAME=nova-commander
VERSION="$(node -p "require('./package.json').version")"
ARCH=amd64
ELECTRON_DIST="$ROOT/node_modules/electron/dist"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
PKG="$STAGE/${NAME}_${VERSION}_${ARCH}"
OPT="$PKG/opt/$NAME"

[ -x "$ELECTRON_DIST/electron" ] || { echo "Electron not installed — run: npm install" >&2; exit 1; }

echo "Rendering icons…"
"$ROOT/node_modules/.bin/electron" build/render-icon.js icon.svg build/icons 2>/dev/null
cp build/icons/256.png icon.png

echo "Staging files…"
mkdir -p "$OPT/resources/app"
cp -a "$ELECTRON_DIST"/. "$OPT/"
mv "$OPT/electron" "$OPT/$NAME"
rm -f "$OPT/resources/default_app.asar"
cp -a main.js preload.js package.json icon.png icon.svg renderer "$OPT/resources/app/"
# Electron's sandbox helper must be setuid root.
chmod 4755 "$OPT/chrome-sandbox"

mkdir -p "$PKG/usr/bin"
ln -s "/opt/$NAME/$NAME" "$PKG/usr/bin/$NAME"

mkdir -p "$PKG/usr/share/applications"
cat > "$PKG/usr/share/applications/$NAME.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Nova Commander
GenericName=File Manager
Comment=Dual-pane file manager (drag = move, Ctrl+drag = copy)
Exec=/opt/$NAME/$NAME %U
Icon=$NAME
Terminal=false
Categories=System;FileTools;FileManager;Utility;
MimeType=inode/directory;
Keywords=files;folders;explorer;commander;
StartupWMClass=$NAME
EOF

for s in 16 32 48 64 128 256 512; do
  d="$PKG/usr/share/icons/hicolor/${s}x${s}/apps"
  mkdir -p "$d"
  cp "build/icons/$s.png" "$d/$NAME.png"
done
mkdir -p "$PKG/usr/share/icons/hicolor/scalable/apps"
cp icon.svg "$PKG/usr/share/icons/hicolor/scalable/apps/$NAME.svg"

# Debian packages must not ship group/world-writable files.
chmod -R go-w "$PKG"

mkdir -p "$PKG/DEBIAN"
INSTALLED_KB="$(du -sk "$PKG" --exclude=DEBIAN | cut -f1)"
cat > "$PKG/DEBIAN/control" <<EOF
Package: $NAME
Version: $VERSION
Section: utils
Priority: optional
Architecture: $ARCH
Installed-Size: $INSTALLED_KB
Maintainer: matthew <firefoxx.ms@gmail.com>
Depends: libgtk-3-0 | libgtk-3-0t64, libnss3, libxss1, libxtst6, libgbm1, libasound2 | libasound2t64, xdg-utils
Recommends: 7zip | p7zip-full, zstd
Description: Modern dark dual-pane file manager inspired by One Commander
 Nova Commander is a dual-pane file manager with Miller columns, tabs,
 colour-coded file ages, folder sizes, thumbnails, colour tags, batch rename,
 archive handling, recursive search, a pausable operation queue, favorite
 groups, a Drop List and a preview panel with photo EXIF. Drag and drop moves
 files by default; hold Ctrl to copy.
EOF

cat > "$PKG/DEBIAN/postinst" <<'EOF'
#!/bin/sh
set -e
chown root:root /opt/nova-commander/chrome-sandbox 2>/dev/null || true
chmod 4755 /opt/nova-commander/chrome-sandbox 2>/dev/null || true
command -v update-desktop-database >/dev/null && update-desktop-database -q /usr/share/applications || true
command -v gtk-update-icon-cache >/dev/null && gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor || true
exit 0
EOF
cat > "$PKG/DEBIAN/postrm" <<'EOF'
#!/bin/sh
set -e
command -v update-desktop-database >/dev/null && update-desktop-database -q /usr/share/applications || true
command -v gtk-update-icon-cache >/dev/null && gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor || true
exit 0
EOF
chmod 755 "$PKG/DEBIAN/postinst" "$PKG/DEBIAN/postrm"

echo "Building package…"
mkdir -p "$ROOT/dist"
dpkg-deb --root-owner-group --build -Zxz "$PKG" "$ROOT/dist/${NAME}_${VERSION}_${ARCH}.deb" >/dev/null
ls -lh "$ROOT/dist/${NAME}_${VERSION}_${ARCH}.deb"
