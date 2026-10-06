#!/usr/bin/env bash
# Builds the app and runs the unit tests, the way CI does:
#
#   SIGN_IDENTITY=- scripts/test.sh      # ad-hoc, no certificate needed
#   scripts/test.sh                      # signs with the Apple Development identity in project.yml
#
# The tests (BoringTalksTests) cover BoringTalksKit and need no host app; building
# the BoringTalks scheme also checks that the app itself compiles.
set -euo pipefail
cd "$(dirname "$0")/.."
args=()
[[ -n "${SIGN_IDENTITY:-}" ]] && args+=(BT_SIGN_IDENTITY="$SIGN_IDENTITY")
xcodegen generate --quiet
xcodebuild -project BoringTalks.xcodeproj -scheme BoringTalks -configuration Debug \
  -derivedDataPath "${DERIVED_DATA:-build/Test}" -destination 'platform=macOS' \
  ${args[@]+"${args[@]}"} test "$@"
