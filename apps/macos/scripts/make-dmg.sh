#!/usr/bin/env bash
# Packs an app into a compressed DMG with an Applications shortcut; the volume is named after the app.
#
#   scripts/make-dmg.sh build/Universal/Build/Products/Release/BoringTalks.app build/BoringTalks.dmg
#
# With SIGN_IDENTITY set to a Developer ID identity the DMG itself is signed too
# (notarization accepts either, but a signed DMG passes Gatekeeper's first check).
set -euo pipefail
APP="${1:?usage: make-dmg.sh <BoringTalks.app> <out.dmg>}"
OUT="${2:?usage: make-dmg.sh <BoringTalks.app> <out.dmg>}"
[[ -d "$APP" ]] || { echo "no app at $APP" >&2; exit 1; }

STAGING="$(mktemp -d)"
trap 'rm -rf "$STAGING"' EXIT
NAME="$(basename "$APP" .app)"
ditto "$APP" "$STAGING/$NAME.app"
ln -s /Applications "$STAGING/Applications"

mkdir -p "$(dirname "$OUT")"
rm -f "$OUT"
hdiutil create -volname "$NAME" -srcfolder "$STAGING" -fs HFS+ -format UDZO -imagekey zlib-level=9 -ov "$OUT" >/dev/null

if [[ "${SIGN_IDENTITY:-}" == "Developer ID Application"* ]]; then
  codesign --sign "$SIGN_IDENTITY" --timestamp ${KEYCHAIN:+--keychain "$KEYCHAIN"} "$OUT"
fi
hdiutil verify "$OUT" >/dev/null
echo "$OUT ($(du -h "$OUT" | cut -f1))"
