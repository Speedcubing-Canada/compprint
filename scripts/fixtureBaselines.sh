# The fixture manifest, sourced by checkFixtures.sh and updateFixtureBaseline.sh so the two cannot
# disagree. One line per fixture: <label> <file renderFixtures.ts writes> <baseline in tests/pdf-baseline>.
# HORIZONTAL_FIXTURES come from the `--horizontal` render pass.

FIXTURES=(
  "nametags_vertical   GrosJouetsaMontreal2026_nametags.pdf     nametags_vertical.pdf"
  "first_timers        GrosJouetsaMontreal2026_first_timers.pdf first_timers.pdf"
  "scorecards          scorecard-layout-test.pdf                scorecards.pdf"
  "long_names          scorecard-long-names-test.pdf            long_names.pdf"
  "long_nametags       nametag-long-names-test.pdf              long_nametags.pdf"
  "long_nametags_h     nametag-long-names-horizontal-test.pdf   long_nametags_h.pdf"
  "staff_nametags      nametag-staff-test.pdf                   staff_nametags.pdf"
  "covers              cover-layout-test.pdf                    covers.pdf"
  "schedule            schedule-layout-test.pdf                 schedule.pdf"
  "checklist           checklist-layout-test.pdf                checklist.pdf"
  "group_overview      group-overview-layout-test.pdf           group_overview.pdf"
  "scorecards_a4       scorecard-layout-test-a4.pdf             scorecards_a4.pdf"
  "scorecards_a6       scorecard-layout-test-a6.pdf             scorecards_a6.pdf"
  "custom_event        custom-event-test.pdf                    custom_event.pdf"
  "merged_rounds       merged-rounds-test.pdf                   merged_rounds.pdf"
  "extras              extras-test.pdf                          extras.pdf"
  "checklist_fr        checklist-layout-test-fr.pdf             checklist_fr.pdf"
  "checklist_es        checklist-layout-test-es.pdf             checklist_es.pdf"
  "checklist_pt        checklist-layout-test-pt.pdf             checklist_pt.pdf"
)

HORIZONTAL_FIXTURES=(
  "nametags_horizontal GrosJouetsaMontreal2026_nametags.pdf     nametags_horizontal.pdf"
)
