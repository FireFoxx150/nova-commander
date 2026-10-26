#!/bin/sh
# Flatpak sandboxes don't allow Chromium's own sandbox, so it's turned off here.
exec /app/lib/nova-commander/nova-commander --no-sandbox "$@"
