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
cp "$TMP/nametag-long-names-test.pdf"              "$OUT/long_nametags.pdf"
cp "$TMP/nametag-staff-test.pdf"                   "$OUT/staff_nametags.pdf"
cp "$TMP/cover-layout-test.pdf"                    "$OUT/covers.pdf"
cp "$TMP/schedule-layout-test.pdf"                 "$OUT/schedule.pdf"
cp "$TMP/checklist-layout-test.pdf"                "$OUT/checklist.pdf"
cp "$TMP/group-overview-layout-test.pdf"           "$OUT/group_overview.pdf"
cp "$TMP/scorecard-layout-test-a4.pdf"             "$OUT/scorecards_a4.pdf"
cp "$TMP/scorecard-layout-test-a6.pdf"             "$OUT/scorecards_a6.pdf"
cp "$TMP/custom-event-test.pdf"                    "$OUT/custom_event.pdf"
cp "$TMP/merged-rounds-test.pdf"                   "$OUT/merged_rounds.pdf"
cp "$TMP/extras-test.pdf"                          "$OUT/extras.pdf"
cp "$TMP/checklist-layout-test-fr.pdf"             "$OUT/checklist_fr.pdf"
cp "$TMP/checklist-layout-test-es.pdf"             "$OUT/checklist_es.pdf"
cp "$TMP/checklist-layout-test-pt.pdf"             "$OUT/checklist_pt.pdf"

FIXTURE_OUT_DIR="$TMP" npm run --silent render:fixtures -- --horizontal >/dev/null
cp "$TMP/GrosJouetsaMontreal2026_nametags.pdf" "$OUT/nametags_horizontal.pdf"

echo "Baseline refreshed in $OUT - review the diff before committing."
