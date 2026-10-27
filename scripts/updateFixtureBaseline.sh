#!/usr/bin/env bash
# Re-render the fixtures and overwrite tests/pdf-baseline with them.
#
# Only after an INTENTIONAL PDF change that has been looked at. checkFixtures.sh prints the
# diff images; refreshing the baseline without opening them defeats the whole check.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="$(dirname "$HERE")"
OUT="$APP/tests/pdf-baseline"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cd "$APP"
source "$HERE/fixtureBaselines.sh"
mkdir -p "$OUT"
copy() { cp "$TMP/$2" "$OUT/$3"; }

FIXTURE_OUT_DIR="$TMP" npm run --silent render:fixtures >/dev/null
for f in "${FIXTURES[@]}"; do copy $f; done

FIXTURE_OUT_DIR="$TMP" npm run --silent render:fixtures -- --horizontal >/dev/null
for f in "${HORIZONTAL_FIXTURES[@]}"; do copy $f; done

echo "Baseline refreshed in $OUT - review the diff before committing."
