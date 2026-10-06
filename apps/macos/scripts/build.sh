#!/usr/bin/env bash
# Universal (arm64 + x86_64) Release build of BoringTalks.app.
#
#   scripts/build.sh                     # signs with the Apple Development identity in project.yml
#   SIGN_IDENTITY=- scripts/build.sh     # ad-hoc (CI without certificates)
#   SIGN_IDENTITY="Developer ID Application: Mikhail Pershin (YS48X6MG6D)" \
#     MARKETING_VERSION=0.2.0 BUILD_NUMBER=42 scripts/build.sh
#
# The app ends up in build/Release/BoringTalks.app; its path is the last line of stdout.
set -euo pipefail
cd "$(dirname "$0")/.."

DERIVED_DATA="${DERIVED_DATA:-build/Universal}"
args=(ARCHS="arm64 x86_64" ONLY_ACTIVE_ARCH=NO)
if [[ -n "${SIGN_IDENTITY:-}" ]]; then
  args+=(BT_SIGN_IDENTITY="$SIGN_IDENTITY")
fi
sign_flags=""
if [[ "${SIGN_IDENTITY:-}" == "Developer ID Application"* ]]; then
  # Notarization needs a secure timestamp (the hardened runtime is on in project.yml)
  # and refuses the get-task-allow entitlement Xcode adds for debugging.
  sign_flags="--timestamp"
  args+=(CODE_SIGN_INJECT_BASE_ENTITLEMENTS=NO)
fi
# CI imports the certificate into a temporary keychain.
if [[ -n "${KEYCHAIN:-}" ]]; then sign_flags="${sign_flags:+$sign_flags }--keychain $KEYCHAIN"; fi
if [[ -n "$sign_flags" ]]; then args+=(OTHER_CODE_SIGN_FLAGS="$sign_flags"); fi
if [[ -n "${MARKETING_VERSION:-}" ]]; then args+=(MARKETING_VERSION="$MARKETING_VERSION"); fi
if [[ -n "${BUILD_NUMBER:-}" ]]; then args+=(CURRENT_PROJECT_VERSION="$BUILD_NUMBER"); fi

xcodegen generate --quiet
xcodebuild -project BoringTalks.xcodeproj -scheme BoringTalks -configuration Release \
  -destination 'generic/platform=macOS' -derivedDataPath "$DERIVED_DATA" \
  "${args[@]}" build | (command -v xcbeautify >/dev/null && xcbeautify --quiet || grep -E "error:|warning: .*BoringTalks|BUILD (SUCCEEDED|FAILED)" || true)

BUILT="$DERIVED_DATA/Build/Products/Release/BoringTalks.app"
[[ -d "$BUILT" ]] || { echo "build failed: $BUILT missing" >&2; exit 1; }
APP="build/Release/BoringTalks.app"
rm -rf "$APP"
mkdir -p "$(dirname "$APP")"
ditto "$BUILT" "$APP"
codesign --verify --deep --strict "$APP"
echo "architectures: $(lipo -archs "$APP/Contents/MacOS/BoringTalks")" >&2
echo "signed by: $(codesign -dvv "$APP" 2>&1 | grep -E '^Authority=' | head -1 || echo 'ad-hoc')" >&2
echo "$APP"
