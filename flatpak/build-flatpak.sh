#!/usr/bin/env bash
# Builds dist/com.github.FireFoxx150.NovaCommander.flatpak with the plain flatpak tools
# (no flatpak-builder needed). Requires the org.freedesktop.Platform and Sdk 26.08 runtimes.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
APP=com.github.FireFoxx150.NovaCommander
RUNTIME_VERSION=26.08
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
B="$WORK/build"

[ -d node_modules/electron/dist ] || { echo "Run npm install first" >&2; exit 1; }
VERSION="$(node -p "require('./package.json').version")"

echo "Rendering icons…"
node_modules/.bin/electron build/render-icon.js icon.svg build/icons 2>/dev/null
cp build/icons/256.png icon.png

flatpak build-init "$B" "$APP" org.freedesktop.Sdk org.freedesktop.Platform "$RUNTIME_VERSION"
mkdir -p "$B/files/lib/nova-commander"
cp -a node_modules/electron/dist/. "$B/files/lib/nova-commander/"
mv "$B/files/lib/nova-commander/electron" "$B/files/lib/nova-commander/nova-commander"
rm -f "$B/files/lib/nova-commander/resources/default_app.asar"
mkdir -p "$B/files/lib/nova-commander/resources/app"
cp -a main.js preload.js package.json icon.png renderer LICENSE THIRD_PARTY_NOTICES.md "$B/files/lib/nova-commander/resources/app/"

mkdir -p "$B/files/bin"
cat > "$B/files/bin/nova-commander" <<'SH'
#!/bin/sh
# Flatpak sandboxes don't allow Chromium's own sandbox, so it's turned off here.
exec /app/lib/nova-commander/nova-commander --no-sandbox "$@"
SH
chmod 755 "$B/files/bin/nova-commander"

install -Dm644 flatpak/$APP.desktop "$B/files/share/applications/$APP.desktop"
install -Dm644 flatpak/$APP.metainfo.xml "$B/files/share/metainfo/$APP.metainfo.xml"
install -Dm644 icon.svg "$B/files/share/icons/hicolor/scalable/apps/$APP.svg"
for s in 16 32 48 64 128 256 512; do
  install -Dm644 "build/icons/$s.png" "$B/files/share/icons/hicolor/${s}x${s}/apps/$APP.png"
done

flatpak build-finish "$B" \
  --command=nova-commander \
  --share=ipc --socket=wayland --socket=fallback-x11 --device=dri \
  --filesystem=host \
  --talk-name=org.freedesktop.Notifications

mkdir -p dist
REPO="$WORK/repo"
flatpak build-export "$REPO" "$B" stable
flatpak build-bundle "$REPO" "dist/$APP.flatpak" "$APP" stable
echo "Built dist/$APP.flatpak (version $VERSION)"
ls -lh "dist/$APP.flatpak"
