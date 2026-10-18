import type { LiveResultsMode, NametTagLogoMode, PaperFormat } from '../types/settings';

// Shared by the PDF documents (worker) and the page-count estimator (main thread).
// Must stay free of any @react-pdf import, or the estimator drags the PDF engine into
// the main bundle.

// One of the 14 PDF base fonts: no embedding, identical in every viewer. Letters outside
// WinAnsi (Ł, ư, ễ...) fall through, per glyph, to an embedded Helvetica clone
// (scripts/makeScorecardSans.py), so PDFs without them embed nothing.
export const PDF_FONT_EXT = 'ScorecardSans';
export const PDF_FONT_BOLD_EXT = 'ScorecardSans-Bold';
export const PDF_FONT = ['Helvetica', PDF_FONT_EXT];
export const PDF_FONT_BOLD = ['Helvetica-Bold', PDF_FONT_BOLD_EXT];

// Schedule tracker and Round Checklist share a clipboard, so they share their chrome.
// Row tint stays light enough to photocopy.
export const TABLE_BORDER = '0.75pt solid #888';
export const TABLE_BORDER_INNER = '0.5pt solid #bbb';
export const TABLE_ROW_ALT = '#f2f2f2';
export const TABLE_HEADER_BG = '#d8d8d8';

// 2x2 grid.
export const SCORECARDS_PER_PAGE = 4;

export const scorecardsPerPage = (a6: boolean) => (a6 ? 1 : SCORECARDS_PER_PAGE);

// Dimensions measured from the original Sarah-scorecard LETTER PDF output:
//   Cards: 257×345pt  |  L/R margins: ~22pt  |  T/B margins: ~24-26pt
//   H gap: ~53pt  |  V gap: ~52pt  (gap ≈ 2× margin on both axes)
// A4 uses the same absolute margins/gaps; cardH fills the remaining page height.
// LETTER: 22+257+53+257+23=612  |  24+345+52+345+26=792
// A4:     22+249+53+249+22=595  |  22+373+52+373+22=842
// A6 is one A4-sized card, centred: 24+249+24.6=297.6  |  23+373+23.5=419.5

// Scorecard header: card border and padding, the left cell (logo or comp name) and the name
// cell beside it. idLineH and compNameLineH are the rendered lines under/over the name.
export const SCORECARD_HEADER = {
  h: 56, cardBorder: 1.5, cardPadH: 3, logoCellW: 80, compNameCellW: 26, nameCellPadH: 3,
  idLineH: 11, compNameLineH: 12,
} as const;

export const SCORECARD_CONFIGS = {
  LETTER: {
    cardW: 257, cardH: 345,
    positions: [
      { left: 22,  top: 24  },  // top-left    (L=22, T=24; H gap=53, V gap=52)
      { left: 332, top: 24  },  // top-right
      { left: 22,  top: 421 },  // bottom-left
      { left: 332, top: 421 },  // bottom-right
    ],
  },
  A4: {
    cardW: 249, cardH: 373,
    positions: [
      { left: 22,  top: 22  },  // 22pt margins on all sides; H gap=53, V gap=52
      { left: 324, top: 22  },
      { left: 22,  top: 447 },
      { left: 324, top: 447 },
    ],
  },
  A6: {
    cardW: 249, cardH: 373,
    positions: [{ left: 24, top: 23 }],
  },
} as const;

// Past this, /generate offers to split a file per event and into parts. See "Generation
// performance" in the README.
export const MAX_PAGES_PER_SCORECARD_PDF = 250;

// Pages @react-pdf draws at once; a bigger file is rendered in parts and merged. 100 beat 250
// on WC-scale heap and time.
export const RENDER_PART_PAGES = 100;

// Tuned so the flex spacers around the provisional label stay 6-8pt each; the budget
// formula is in ScorecardDocument.tsx, the guard in scorecard-layout.test.ts.
export const ROW_HEIGHTS = {
  avg5: 34, 'bo2-avg5': 31, mo3: 51, 'bo1-mo3': 49, bo2: 55, bo1: 100,
} as const;

// A4 cards are 28pt taller than LETTER (373 vs 345). The rows absorb it, so the spacers keep
// their LETTER size instead of leaving a gap around the provisional label.
const A4_EXTRA_CARD_H = 28;

/** `rows` counts the numbered attempt rows; the extra row takes its share too. */
export function scorecardRowHeight(
  format: keyof typeof ROW_HEIGHTS, paper: 'A4' | 'LETTER', rows: number,
): number {
  return ROW_HEIGHTS[format] + (paper === 'A4' ? A4_EXTRA_CARD_H / (rows + 1) : 0);
}

// Four people per page, front + back panel each.
export const NAMETAGS_PER_PAGE = 4;

// Same cap, same choice.
export const MAX_PAGES_PER_NAMETAG_PDF = 250;

// Vertical name tag panels.
export const NAMETAG_CONFIGS = {
  LETTER: { panelW: 189, panelH: 292, margin: 12, gapH: 4, gapV: 4 },
  A4:     { panelW: 201, panelH: 283, margin: 12, gapH: 4, gapV: 4 },
} as const;

// Empirical top-section height, for the duty font-size estimate. 'logo-only' adds ~19pt of
// header (28pt logo vs 8.5pt text); compact compresses it to fit the 147pt card.
export function nametagTopSectionH(logoMode: NametTagLogoMode, compact = false) {
  if (compact) return logoMode === 'logo-only' ? 75 : 65;
  return logoMode === 'logo-only' ? 146 : 127;
}

// Vertical top section minus all but the name: header, badge (22 + 4), icons (6 + 12 + 4),
// WCA ID (13pt line + 4) and the name's own 6pt margin. More and the badge drops.
export function nametagNameH(logoMode: NametTagLogoMode) {
  const header = logoMode === 'hidden' ? 8.5 * 1.1 + 4 : logoMode === 'with-name' ? 20 + 3 : 28 + 4;
  return nametagTopSectionH(logoMode) - header - 26 - 22 - (13 * 1.1 + 4) - 6;
}

// The compact layout is tight enough that the QR side must stay uncluttered.
export function eventIconsVisible({ isQrSide, compact }: { isQrSide: boolean; compact: boolean }): boolean {
  return !(isQrSide && compact);
}

// Flex units, not points: the table fills the page width. `event` carries the longest
// text in the table (FR "3x3x3 à Une Main Tour 1", ~127pt) and has the least headroom.
// checking-sheet-layout.test.ts asserts every cell fits in every locale on both paper
// sizes: widen the column rather than truncating a translation.
export const CHECKING_FLEX = {
  start: 1,
  event: 2.7,
  groups: 1,
  scorecards: 1.1,
  dataEntry: 1.3,
  doubleCheck: 1.35,
  takenBy: 1.55,
};

// Taller than the schedule tracker's 6pt: these columns are filled in by hand.
export const CHECKING_CELL_PAD_V = 9;

// Shared with ScorecardDocument styles.coverCheckBox: same box in either mode.
export const CHECKING_BOX = 9;

// Lunch divider. Must read as one against the 0.5pt #bbb ordinary row rule.
export const CHECKING_BREAK_RULE = '1.5pt solid #444';
export const CHECKING_BREAK_RULE_W = 1.5;

// First-timer slip pitch. Fixed-height rows because @react-pdf inflates lineHeight by a
// constant factor. Sized so three large slips (4-5 events) still fit one page.
export const SLIP_FONT_SIZE = 10;
export const SLIP_LINE_H = 13;
export const SLIP_PAGE_PAD_TOP = 38;
export const SLIP_PAGE_PAD_BOTTOM = 36;
// One blank line beyond the base 18pt, so the cut point is unmistakable.
export const SLIP_MARGIN_BOTTOM = 18 + SLIP_LINE_H;
export const SLIP_INTRO_MARGIN_BOTTOM = 20;

// `hideWcaLiveId` only suppresses the line where there is no ID to print (liveId ''):
// blank, extra and custom-event cards. A competitor's card always keeps its ID.
export const showLiveIdLine = (hideWcaLiveId: boolean, liveId: string) =>
  !hideWcaLiveId || liveId !== '';

// The two live-results systems use unrelated competitor ids: wca-live needs a numeric
// competition id and person id off its GraphQL API, ilr builds the URL from ids already
// in hand. A missing wca-live id falls back to the home page, so the QR still scans.
export function liveQrTarget(
  cfg: {
    mode: LiveResultsMode;
    competitionId: string;
    wcaLiveId: string | null;
    wcaLivePersonIds: Record<number, string> | null;
  },
  entry: { registrantId: number; registrationId: number; blank?: boolean; staff?: boolean },
): { url: string; label: string } {
  const toComp = entry.blank || entry.staff;
  if (cfg.mode === 'ilr') {
    const live = `https://www.worldcubeassociation.org/competitions/${cfg.competitionId}/live`;
    return {
      url: toComp ? live : `${live}/competitors/${entry.registrationId}`,
      label: 'worldcubeassociation.org',
    };
  }
  const personId = cfg.wcaLivePersonIds?.[entry.registrantId] ?? null;
  const home = 'https://live.worldcubeassociation.org';
  const comp = `${home}/competitions/${cfg.wcaLiveId}`;
  return {
    url: !cfg.wcaLiveId ? home
      : toComp ? comp
      : personId ? `${comp}/competitors/${personId}`
      : home,
    label: 'live.worldcubeassociation.org',
  };
}

// Group Overview. Flex units, not points: the table fills the page width. Competitor
// names carry an ordinal prefix and judge lists are the longest, so those two are wider.
// group-overview-layout.test.ts asserts every header fits in every locale on both sizes.
export const GROUP_OVERVIEW_FLEX = {
  competitors: 1.45,
  scramblers: 1,
  runners: 1,
  judges: 1.45,
};

export const GROUP_OVERVIEW = {
  pagePadH: 30,
  pagePadV: 36,
  fontSize: 9,
  lineH: 12,
  headerH: 18,
  headingH: 17,   // "3x3x3 Cube Round 1 - Group 2"
  subHeadH: 14,   // "09:00 - 09:25   Room: Salon"
  dayLabelH: 19,
  cellPadV: 4,
  blockGap: 14,
  titleH: 40,
};

const PAGE_H: Record<PaperFormat, number> = { LETTER: 792, A4: 842 };

/** One group's block, including the gap below it. Shared so the estimator cannot drift. */
export function groupBlockHeight(maxColumnRows: number, withDayLabel: boolean): number {
  const G = GROUP_OVERVIEW;
  return (withDayLabel ? G.dayLabelH : 0)
    + G.headingH + G.subHeadH
    + G.headerH + maxColumnRows * G.lineH + 2 * G.cellPadV
    + G.blockGap;
}

/**
 * True when a block is short enough to be worth pinning with wrap={false}. react-pdf squashes
 * an oversized non-breaking block instead of paginating it (see the Round Checklist note in
 * the README), so a freakishly large group has to be allowed to break across pages.
 */
export function groupBlockFitsPage(
  maxColumnRows: number, withDayLabel: boolean, paperFormat: PaperFormat,
): boolean {
  const usable = (PAGE_H[paperFormat] ?? PAGE_H.LETTER) - 2 * GROUP_OVERVIEW.pagePadV;
  return groupBlockHeight(maxColumnRows, withDayLabel) <= usable;
}

/**
 * Blocks are wrap={false}, so one that does not fit the remaining height starts a new page.
 * A block taller than a whole page still gets its own, which is what @react-pdf does with it.
 */
export function estimateGroupOverviewPages(
  blocks: { rows: number; withDayLabel: boolean }[],
  paperFormat: PaperFormat,
): number {
  if (blocks.length === 0) return 0;
  const usable = (PAGE_H[paperFormat] ?? PAGE_H.LETTER) - 2 * GROUP_OVERVIEW.pagePadV;
  let pages = 1;
  let used = GROUP_OVERVIEW.titleH;
  for (const b of blocks) {
    const h = groupBlockHeight(b.rows, b.withDayLabel);
    if (used > 0 && used + h > usable) { pages++; used = 0; }
    used += h;
  }
  return pages;
}
