#!/usr/bin/env bash
# Releases the Mac app from this machine: Developer ID signing, DMG, notarization, R2 publish.
# CI only builds and tests; signing keys never leave the developer's Mac.
#
#   scripts/release.sh prod            # BoringTalks → download.boringtalks.lol/BoringTalks-latest.dmg
#   scripts/release.sh dev             # BoringTalks Dev (dev environment) → download.boringtalks.lol/dev/BoringTalks-Dev-latest.dmg
#   WAIT=1 scripts/release.sh prod     # wait for Apple's notary service, staple, then publish
#   NO_PUBLISH=1 scripts/release.sh dev # signed build + DMG only, to try it locally
#
# Without WAIT the DMG is published signed but not yet notarized, and the notarization is only
# submitted; once `xcrun notarytool info <id> …` says Accepted, run
#   scripts/release.sh staple prod     # staples build/BoringTalks.dmg and republishes it as notarized
#
# Env (defaults point at the gitignored .local/secrets of this repo):
#   DEVELOPER_ID_P12, DEVELOPER_ID_P12_PASSWORD_FILE   Developer ID Application certificate + key
#   PROFILE                                            Developer ID provisioning profile of the app's bundle ID
#                                                      (default .local/secrets/apple/BoringTalks[Dev].provisionprofile)
#   ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH            App Store Connect API key for notarytool
#   R2_SECRETS                                         file with the R2 access key id and secret, one per line
#   BUILD_NUMBER                                       default: seconds since 2026-01-01 / 60
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(cd ../.. && pwd)"
MODE="${1:?usage: release.sh prod|dev | staple prod|dev}"
if [[ "$MODE" == "staple" ]]; then STAPLE=1; TARGET="${2:?staple prod|dev}"; else STAPLE=0; TARGET="$MODE"; fi
case "$TARGET" in
  prod) PREFIX=""; FLAVOR=production; NAME=BoringTalks; DMG_NAME=BoringTalks; PROFILE_NAME=BoringTalks ;;
  dev) PREFIX="dev/"; FLAVOR=dev; NAME="BoringTalks Dev"; DMG_NAME=BoringTalks-Dev; PROFILE_NAME=BoringTalksDev ;;
  *) echo "target must be prod or dev" >&2; exit 1 ;;
esac

DEVELOPER_ID_P12="${DEVELOPER_ID_P12:-$ROOT/.local/secrets/apple/devid.p12}"
DEVELOPER_ID_P12_PASSWORD_FILE="${DEVELOPER_ID_P12_PASSWORD_FILE:-$ROOT/.local/secrets/apple/devid.p12.password}"
export ASC_KEY_ID="${ASC_KEY_ID:-7YWP5BZGUC}"
export ASC_ISSUER_ID="${ASC_ISSUER_ID:-ab1ce0fe-322f-431f-bc9a-94bff162fdc3}"
export ASC_KEY_PATH="${ASC_KEY_PATH:-$HOME/.appstoreconnect/private_keys/AuthKey_$ASC_KEY_ID.p8}"
R2_SECRETS="${R2_SECRETS:-$ROOT/.local/secrets/r2}"
PROFILE="${PROFILE:-$ROOT/.local/secrets/apple/$PROFILE_NAME.provisionprofile}"
VERSION=$(sed -n 's/^ *MARKETING_VERSION: *"\{0,1\}\([^"]*\)"\{0,1\}$/\1/p' project.yml | head -1)
APP="build/Release/$NAME.app"
DMG="build/$DMG_NAME.dmg"
BUILD_FILE="build/$DMG_NAME.build"

publish() {
  R2_ACCESS_KEY_ID=$(sed -n 1p "$R2_SECRETS") R2_SECRET_ACCESS_KEY=$(sed -n 2p "$R2_SECRETS") \
    R2_ENDPOINT=https://924ba8ce0dcdcd4e131bebe3dc05b84c.r2.cloudflarestorage.com R2_DOWNLOADS_BUCKET=boringtalks \
    DOWNLOADS_BASE_URL=https://download.boringtalks.lol DMG_NAME="$DMG_NAME" scripts/publish.sh "$DMG" "$VERSION" "$1" "$2" "$PREFIX"
}

if [[ "$STAPLE" == 1 ]]; then
  BUILD=$(cat "$BUILD_FILE")
  xcrun stapler staple "$DMG"
  xcrun stapler validate "$DMG"
  publish "$BUILD" true
  exit 0
fi

BUILD="${BUILD_NUMBER:-$(( ($(date +%s) - 1767225600) / 60 ))}"

# The certificate goes into a throwaway keychain that is on the search list only during the build.
KEYCHAIN="$(mktemp -d)/release.keychain-db"
KEYCHAIN_PASSWORD="$(uuidgen)"
ORIGINAL_KEYCHAINS=$(security list-keychains -d user | tr -d '"')
cleanup() {
  # shellcheck disable=SC2086
  security list-keychains -d user -s $ORIGINAL_KEYCHAINS
  security delete-keychain "$KEYCHAIN" 2>/dev/null || true
}
trap cleanup EXIT
security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
security set-keychain-settings -lut 3600 "$KEYCHAIN"
security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
security import "$DEVELOPER_ID_P12" -k "$KEYCHAIN" -P "$(cat "$DEVELOPER_ID_P12_PASSWORD_FILE")" -T /usr/bin/codesign >/dev/null
security set-key-partition-list -S apple-tool:,apple: -s -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN" >/dev/null
# shellcheck disable=SC2086
security list-keychains -d user -s "$KEYCHAIN" $ORIGINAL_KEYCHAINS
IDENTITY=$(security find-identity -v -p codesigning "$KEYCHAIN" | sed -n 's/.*"\(Developer ID Application:.*\)"/\1/p' | head -1)
[[ -n "$IDENTITY" ]] || { echo "no Developer ID Application identity in $DEVELOPER_ID_P12" >&2; exit 1; }

[[ -f "$PROFILE" ]] || { echo "no provisioning profile at $PROFILE" >&2; exit 1; }
TEAM_ID=$(sed -n 's/.*(\([A-Z0-9]\{10\}\))$/\1/p' <<< "$IDENTITY")

FLAVOR="$FLAVOR" SIGN_IDENTITY="$IDENTITY" KEYCHAIN="$KEYCHAIN" BUILD_NUMBER="$BUILD" scripts/build.sh
# Re-sign the app with the Keychain access group, which the embedded profile authorises
# (Xcode would want the profile installed and would also offer it to the library targets).
BUNDLE_ID=$(/usr/libexec/PlistBuddy -c "Print CFBundleIdentifier" "$APP/Contents/Info.plist")
ENTITLEMENTS="$(dirname "$KEYCHAIN")/app.entitlements"
sed -e "s/TEAM_ID/$TEAM_ID/g" -e "s/BUNDLE_ID/$BUNDLE_ID/g" Signing/Distribution.entitlements > "$ENTITLEMENTS"
cp "$PROFILE" "$APP/Contents/embedded.provisionprofile"
codesign --force --sign "$IDENTITY" --keychain "$KEYCHAIN" --options runtime --timestamp --entitlements "$ENTITLEMENTS" "$APP"
codesign --verify --deep --strict "$APP"
codesign -dv "$APP" 2>&1 | grep -E "Authority=Developer ID|Timestamp"
# The profile must grant what the app now claims, or macOS refuses to launch it.
"$APP/Contents/MacOS/$NAME" --keychain-check | tee /dev/stderr | grep -q "data protection" ||
  { echo "$APP does not use the data protection keychain" >&2; exit 1; }

SIGN_IDENTITY="$IDENTITY" KEYCHAIN="$KEYCHAIN" scripts/make-dmg.sh "$APP" "$DMG"
echo "$BUILD" > "$BUILD_FILE"
if [[ "${NO_PUBLISH:-0}" == 1 ]]; then echo "built $DMG (not notarized, not published)"; exit 0; fi

if [[ "${WAIT:-0}" == 1 ]]; then
  scripts/notarize.sh "$DMG"
  publish "$BUILD" true
else
  ID=$(xcrun notarytool submit "$DMG" --key "$ASC_KEY_PATH" --key-id "$ASC_KEY_ID" --issuer "$ASC_ISSUER_ID" --no-wait --output-format json |
    /usr/bin/python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
  echo "notarization submitted: $ID (check: xcrun notarytool info $ID --key … ; then: scripts/release.sh staple $TARGET)"
  echo "$ID" > "build/$DMG_NAME.notarization"
  publish "$BUILD" false
fi
