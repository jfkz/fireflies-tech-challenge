#!/usr/bin/env bash
# Notarizes and staples a DMG with an App Store Connect API key.
#
#   ASC_KEY_ID=… ASC_ISSUER_ID=… ASC_KEY_PATH=~/.appstoreconnect/private_keys/AuthKey_….p8 \
#     scripts/notarize.sh build/BoringTalks.dmg
#
# ASC_KEY_P8 (the key's contents, as a CI secret) works instead of ASC_KEY_PATH.
# Exit codes (CI decides `notarized` from them): 0 = notarized and stapled,
# 1 = notarization failed, 2 = skipped because the key isn't configured.
set -euo pipefail
DMG="${1:?usage: notarize.sh <file.dmg>}"

if [[ -z "${ASC_KEY_PATH:-}" && -n "${ASC_KEY_P8:-}" ]]; then
  ASC_KEY_PATH="$(mktemp -d)/AuthKey_${ASC_KEY_ID:-key}.p8"
  printf '%s\n' "$ASC_KEY_P8" > "$ASC_KEY_PATH"
  trap 'rm -f "$ASC_KEY_PATH"' EXIT
fi
if [[ -z "${ASC_KEY_ID:-}" || -z "${ASC_ISSUER_ID:-}" || -z "${ASC_KEY_PATH:-}" || ! -f "${ASC_KEY_PATH:-/nonexistent}" ]]; then
  echo "ASC_KEY_ID / ASC_ISSUER_ID / ASC_KEY_PATH not set: $DMG is NOT notarized (Gatekeeper will ask users to right-click → Open)." >&2
  exit 2
fi

RESULT="$(mktemp)"
xcrun notarytool submit "$DMG" --key "$ASC_KEY_PATH" --key-id "$ASC_KEY_ID" --issuer "$ASC_ISSUER_ID" \
  --wait --timeout 30m --output-format json | tee "$RESULT"
STATUS="$(/usr/bin/python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("status",""))' "$RESULT")"
ID="$(/usr/bin/python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("id",""))' "$RESULT")"
if [[ "$STATUS" != "Accepted" ]]; then
  echo "notarization $STATUS — log:" >&2
  [[ -n "$ID" ]] && xcrun notarytool log "$ID" --key "$ASC_KEY_PATH" --key-id "$ASC_KEY_ID" --issuer "$ASC_ISSUER_ID" >&2 || true
  exit 1
fi

xcrun stapler staple "$DMG"
xcrun stapler validate "$DMG"
spctl --assess --type open --context context:primary-signature --verbose "$DMG" || true
echo "$DMG is notarized and stapled."
