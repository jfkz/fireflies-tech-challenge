#!/usr/bin/env bash
# Uploads a DMG and latest.json to the public downloads bucket (Cloudflare R2, S3 API).
#
#   scripts/publish.sh build/BoringTalks.dmg 0.1.0 42 true          # production
#   scripts/publish.sh build/BoringTalks.dmg 0.1.0 42 false dev/    # dev environment
#
# Env: R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_DOWNLOADS_BUCKET,
#      DOWNLOADS_BASE_URL (e.g. https://download.boringtalks.lol).
# Writes  [prefix]BoringTalks-<version>.dmg, [prefix]BoringTalks-latest.dmg and
# [prefix]latest.json, whose shape is LatestDownload in packages/shared/src/user.ts.
set -euo pipefail
DMG="${1:?usage: publish.sh <dmg> <version> <build> <notarized:true|false> [prefix]}"
VERSION="${2:?version missing}"
BUILD="${3:?build missing}"
NOTARIZED="${4:?notarized (true|false) missing}"
PREFIX="${5:-}"

[[ -f "$DMG" ]] || { echo "no DMG at $DMG" >&2; exit 1; }
[[ "$NOTARIZED" == "true" || "$NOTARIZED" == "false" ]] || { echo "notarized must be true or false" >&2; exit 1; }
[[ "$VERSION" =~ ^[0-9A-Za-z.+-]+$ && "$BUILD" =~ ^[0-9A-Za-z.+-]+$ ]] || { echo "bad version or build" >&2; exit 1; }
for name in R2_ENDPOINT R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_DOWNLOADS_BUCKET DOWNLOADS_BASE_URL; do
  [[ -n "${!name:-}" ]] || { echo "$name is not set" >&2; exit 1; }
done
# "dev", "/dev", "dev/" → "dev/"
PREFIX="${PREFIX#/}"
[[ -n "$PREFIX" && "$PREFIX" != */ ]] && PREFIX="$PREFIX/"

SIZE="$(stat -f%z "$DMG" 2>/dev/null || stat -c%s "$DMG")"
NAME="BoringTalks-$VERSION.dmg"
URL="${DOWNLOADS_BASE_URL%/}/$PREFIX$NAME"
PUBLISHED_AT="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
LATEST="$(mktemp)"
trap 'rm -f "$LATEST"' EXIT
cat > "$LATEST" <<JSON
{
  "version": "$VERSION",
  "build": "$BUILD",
  "url": "$URL",
  "sizeBytes": $SIZE,
  "minimumOs": "26.0",
  "notarized": $NOTARIZED,
  "publishedAt": "$PUBLISHED_AT"
}
JSON

export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" AWS_DEFAULT_REGION=auto
s3() { aws s3 cp --endpoint-url "$R2_ENDPOINT" --only-show-errors "$@"; }
BUCKET="s3://$R2_DOWNLOADS_BUCKET/$PREFIX"
s3 "$DMG" "$BUCKET$NAME" --content-type application/x-apple-diskimage --cache-control "public, max-age=31536000, immutable"
s3 "$DMG" "${BUCKET}BoringTalks-latest.dmg" --content-type application/x-apple-diskimage --cache-control "public, max-age=300"
s3 "$LATEST" "${BUCKET}latest.json" --content-type application/json --cache-control "public, max-age=60"

echo "published $URL ($SIZE bytes, notarized=$NOTARIZED)"
cat "$LATEST"
