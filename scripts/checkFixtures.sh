#!/usr/bin/env bash
# Re-render every fixture PDF and diff it against a committed baseline.
#
#   scripts/checkFixtures.sh [baseline-dir] [outdir] [dpi]
#
# Defaults to tests/pdf-baseline, so CI and a local run check the same thing. The layout
# unit tests assert measurements; this catches everything they cannot see - a changed
# colour, a shifted margin, a dropped glyph. Exits non-zero if any page differs.
#
# Needs poppler-utils (pdftoppm) and graphicsmagick (gm).
#
# Refresh the baseline after an INTENTIONAL layout change, once the new output has been
# eyeballed:  scripts/updateFixtureBaseline.sh
#
# TOLERANCE, not exact zero: the runner's poppler and font stack differ from a dev
# machine's, and anti-aliasing alone lands around 1e-4. Anything a print job would care
# about - a shifted margin, a resized card, a dropped glyph - is orders of magnitude above
# this. Raise it only with a reason; the point is to catch real layout drift.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="$(dirname "$HERE")"

BASELINE="$(cd "${1:-$APP/tests/pdf-baseline}" && pwd)"
OUTDIR="${2:-${TMPDIR:-/tmp}/fixture-check}"
DPI="${3:-150}"
TOLERANCE="${FIXTURE_MAE_TOLERANCE:-0.002}"

RENDERED="$OUTDIR/rendered"
DIFF="$HERE/pdfDiff.sh"

for tool in pdftoppm gm; do
  command -v "$tool" >/dev/null || { echo "ERROR: $tool not installed" >&2; exit 2; }
done

rm -rf "$OUTDIR"; mkdir -p "$RENDERED"
fail=0

check() { # <label> <rendered-basename> <baseline-basename>
  local label="$1" got="$RENDERED/$2" want="$BASELINE/$3"
  if [ ! -f "$want" ]; then
    echo "SKIP $label (no baseline at $want)"; return
  fi
  bash "$DIFF" "$want" "$got" "$OUTDIR/$label" "$DPI" >"$OUTDIR/$label.log" 2>&1 || true
  local max
  max=$(awk '/^max page MAE:/ {print $4}' "$OUTDIR/$label.log")
  # Guard against an empty/failed run reading as a pass.
  if [ -z "$max" ]; then
    echo "FAIL $label - diff produced no metric (see $OUTDIR/$label.log)"; fail=1; return
  fi
  if awk -v m="$max" -v t="$TOLERANCE" 'BEGIN{exit !(m+0<=t+0)}'; then
    echo "OK   $label (max page MAE $max)"
  else
    echo "FAIL $label - max page MAE $max exceeds $TOLERANCE (see $OUTDIR/$label/)"
    fail=1
  fi
}

cd "$APP"
FIXTURE_OUT_DIR="$RENDERED" npm run --silent render:fixtures >/dev/null
check nametags_vertical GrosJouetsaMontreal2026_nametags.pdf     nametags_vertical.pdf
check first_timers      GrosJouetsaMontreal2026_first_timers.pdf first_timers.pdf
check scorecards        scorecard-layout-test.pdf                scorecards.pdf
check long_names        scorecard-long-names-test.pdf            long_names.pdf
check covers            cover-layout-test.pdf                    covers.pdf
check schedule          schedule-layout-test.pdf                 schedule.pdf
check checklist         checklist-layout-test.pdf                checklist.pdf
check group_overview    group-overview-layout-test.pdf           group_overview.pdf

FIXTURE_OUT_DIR="$RENDERED" npm run --silent render:fixtures -- --horizontal >/dev/null
check nametags_horizontal GrosJouetsaMontreal2026_nametags.pdf nametags_horizontal.pdf

if [ "$fail" -ne 0 ]; then
  echo
  echo "PDF OUTPUT CHANGED - inspect the diff images under $OUTDIR/ before continuing."
  echo "If the change was intended: scripts/updateFixtureBaseline.sh"
  exit 1
fi
echo "All fixtures match the baseline."
