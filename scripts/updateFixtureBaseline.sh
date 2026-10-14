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
mkdir -p "$OUT"
FIXTURE_OUT_DIR="$TMP" npm run --silent render:fixtures >/dev/null
cp "$TMP/GrosJouetsaMontreal2026_nametags.pdf"     "$OUT/nametags_vertical.pdf"
cp "$TMP/GrosJouetsaMontreal2026_first_timers.pdf" "$OUT/first_timers.pdf"
cp "$TMP/scorecard-layout-test.pdf"                "$OUT/scorecards.pdf"
cp "$TMP/scorecard-long-names-test.pdf"            "$OUT/long_names.pdf"
cp "$TMP/cover-layout-test.pdf"                    "$OUT/covers.pdf"
cp "$TMP/schedule-layout-test.pdf"                 "$OUT/schedule.pdf"
cp "$TMP/checklist-layout-test.pdf"                "$OUT/checklist.pdf"
cp "$TMP/group-overview-layout-test.pdf"           "$OUT/group_overview.pdf"

FIXTURE_OUT_DIR="$TMP" npm run --silent render:fixtures -- --horizontal >/dev/null
cp "$TMP/GrosJouetsaMontreal2026_nametags.pdf" "$OUT/nametags_horizontal.pdf"

echo "Baseline refreshed in $OUT - review the diff before committing."
