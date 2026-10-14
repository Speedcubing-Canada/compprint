import { describe, it, expect } from 'vitest';
import { getStrings } from '../lib/i18n';
import { ROW_HEIGHTS, scorecardRowHeight, showLiveIdLine } from './layoutConstants';

// Layout geometry constraints
// Dimensions measured from the original Sarah-scorecard LETTER PDF:
//   Cards: 257×345pt  |  margins ~22-24pt  |  gaps ~52-53pt
//   V gap ≈ 2× margin (not 3×) - the constraint the printed output hinges on.
//   E1 row must nearly touch the card bottom (verified by: content fills ~335pt inner height).

const LETTER_W = 612;
const LETTER_H = 792;
const A4_W = 595;
const A4_H = 842;
const A6_W = 297.64;
const A6_H = 419.53;

const CONFIGS = {
  LETTER: {
    cardW: 257, cardH: 345,
    positions: [
      { left: 22,  top: 24  },
      { left: 332, top: 24  },
      { left: 22,  top: 421 },
      { left: 332, top: 421 },
    ],
  },
  A4: {
    cardW: 249, cardH: 373,
    positions: [
      { left: 22,  top: 22  },
      { left: 324, top: 22  },
      { left: 22,  top: 447 },
      { left: 324, top: 447 },
    ],
  },
} as const;

// A6 printers have their own non-printable border; 5mm is the usual worst case.
describe('A6 scorecard geometry', () => {
  const card = CONFIGS.A4;
  const pos = { left: 24, top: 23 };
  const MIN_MARGIN = 14; // 5mm

  it('the A4 card fits centred on the A6 page with a printable margin all round', () => {
    const right = A6_W - pos.left - card.cardW;
    const bottom = A6_H - pos.top - card.cardH;
    for (const m of [pos.left, pos.top, right, bottom]) expect(m).toBeGreaterThanOrEqual(MIN_MARGIN);
    expect(Math.abs(pos.left - right)).toBeLessThan(1);
    expect(Math.abs(pos.top - bottom)).toBeLessThan(1);
  });
});

describe('Scorecard layout geometry', () => {
  for (const [fmt, page] of [['LETTER', { w: LETTER_W, h: LETTER_H }], ['A4', { w: A4_W, h: A4_H }]] as const) {
    const cfg = CONFIGS[fmt];
    const [p0, p1, p2, p3] = cfg.positions;
    const { cardW, cardH } = cfg;

    describe(fmt, () => {
      it('all four cards fit within the page', () => {
        for (const p of [p0, p1, p2, p3]) {
          expect(p.left).toBeGreaterThanOrEqual(0);
          expect(p.top).toBeGreaterThanOrEqual(0);
          expect(p.left + cardW).toBeLessThanOrEqual(page.w);
          expect(p.top  + cardH).toBeLessThanOrEqual(page.h);
        }
      });

      it('top-left and top-right cards share the same top edge', () => {
        expect(p0.top).toBe(p1.top);
      });

      it('bottom-left and bottom-right cards share the same top edge', () => {
        expect(p2.top).toBe(p3.top);
      });

      it('left cards share the same left edge', () => {
        expect(p0.left).toBe(p2.left);
      });

      it('right cards share the same left edge', () => {
        expect(p1.left).toBe(p3.left);
      });

      it('horizontal gap equals right-card left minus (left-card left + cardW)', () => {
        const hGap = p1.left - (p0.left + cardW);
        expect(hGap).toBeGreaterThan(0);
      });

      it('vertical gap is approximately 2× the top margin (not 3×+)', () => {
        const topMargin = p0.top;
        const vGap = p2.top - (p0.top + cardH);
        // The original PDF has vGap ≈ 2× margin. Allow a tolerance of ±15pt.
        expect(vGap).toBeLessThanOrEqual(topMargin * 2 + 15);
        expect(vGap).toBeGreaterThan(0);
      });

      it('LETTER card dimensions match original PDF measurements (257×345pt)', () => {
        if (fmt === 'LETTER') {
          expect(cardW).toBe(257);
          expect(cardH).toBe(345);
        }
      });
    });
  }
});

// Card inner height budget (LETTER): 335pt, minus header 56, event row 25, table header 19,
// provisional line 19, one extra attempt row and a 13pt cutoff line on the split formats.
// What remains is split into the two flex spacers around the provisional label.

const INNER_H = 335;
const FIXED_H = 56 + 25 + 19 + 19; // header + eventRow + tableHeader + provLine
const CUTOFF_LINE_H = 13;

// rows = pre + post attempt rows; extra/provisional row adds one more rowH.
const FORMAT_ROWS: Record<keyof typeof ROW_HEIGHTS, { rows: number; cutoffLine: boolean }> = {
  avg5:       { rows: 5, cutoffLine: false },
  'bo2-avg5': { rows: 5, cutoffLine: true },
  mo3:        { rows: 3, cutoffLine: false },
  'bo1-mo3':  { rows: 3, cutoffLine: true },
  bo2:        { rows: 2, cutoffLine: false },
  bo1:        { rows: 1, cutoffLine: false },
};

describe('Scorecard attempt-row heights', () => {
  it('every scorecard format has a row height', () => {
    expect(Object.keys(ROW_HEIGHTS).sort()).toEqual(
      ['avg5', 'bo2-avg5', 'mo3', 'bo1-mo3', 'bo2', 'bo1'].sort(),
    );
  });

  for (const [fmt, { rows, cutoffLine }] of Object.entries(FORMAT_ROWS)) {
    it(`${fmt} content fits the card with non-negative spacers`, () => {
      const rowH = ROW_HEIGHTS[fmt as keyof typeof ROW_HEIGHTS];
      const used = FIXED_H + (cutoffLine ? CUTOFF_LINE_H : 0) + (rows + 1) * rowH;
      expect(used).toBeLessThanOrEqual(INNER_H);
    });
  }

  it('bo1 spacers stay in the same visual band as avg5 (single row fills the card)', () => {
    const spacer = (fmt: 'avg5' | 'bo1') =>
      (INNER_H - FIXED_H - (FORMAT_ROWS[fmt].rows + 1) * ROW_HEIGHTS[fmt]) / 2;
    expect(spacer('bo1')).toBeGreaterThanOrEqual(4);
    expect(spacer('bo1')).toBeLessThanOrEqual(12);
    expect(Math.abs(spacer('bo1') - spacer('avg5'))).toBeLessThanOrEqual(4);
  });

  // A4 cards are 28pt taller; left to the spacers, that opened a ~20pt gap on each side of
  // the provisional label. The rows absorb it instead.
  for (const [fmt, { rows, cutoffLine }] of Object.entries(FORMAT_ROWS)) {
    it(`${fmt} spacers are the same on A4 as on LETTER`, () => {
      const spacer = (paper: 'A4' | 'LETTER', innerH: number) => (innerH - FIXED_H
        - (cutoffLine ? CUTOFF_LINE_H : 0)
        - (rows + 1) * scorecardRowHeight(fmt as keyof typeof ROW_HEIGHTS, paper, rows)) / 2;
      expect(spacer('A4', INNER_H + 28)).toBeCloseTo(spacer('LETTER', INNER_H));
    });
  }
});

// Nametag vertical layout geometry
// Landscape page, 4 cols × 2 rows = 8 portrait slots = 4 nametag pairs per page.
// Slot sizes: LETTER 189×292pt, A4 201×283pt. Margins 12pt, gaps 4pt.

const NAMETAG_LANDSCAPE_W = { LETTER: 792, A4: 841 };  // landscape page width (A4 841.89 truncated)
const NAMETAG_LANDSCAPE_H = { LETTER: 612, A4: 595 };

const NAMETAG_V_CONFIGS = {
  LETTER: { panelW: 189, panelH: 292, margin: 12, gapH: 4, gapV: 4 },
  A4:     { panelW: 201, panelH: 283, margin: 12, gapH: 4, gapV: 4 },
} as const;

describe('Nametag vertical layout geometry', () => {
  for (const fmt of ['LETTER', 'A4'] as const) {
    const cfg = NAMETAG_V_CONFIGS[fmt];

    describe(fmt, () => {
      it('4 slots (2 pairs) fit horizontally within landscape page width', () => {
        const usedW = 4 * cfg.panelW + 3 * cfg.gapH + 2 * cfg.margin;
        expect(usedW).toBeLessThanOrEqual(NAMETAG_LANDSCAPE_W[fmt] + 5);
      });

      it('2 rows fit vertically within landscape page height', () => {
        const usedH = 2 * cfg.panelH + cfg.gapV + 2 * cfg.margin;
        expect(usedH).toBeLessThanOrEqual(NAMETAG_LANDSCAPE_H[fmt] + 5);
      });

      it('8 slots (4 pairs) fit per page', () => {
        const cols = Math.floor((NAMETAG_LANDSCAPE_W[fmt] - 2 * cfg.margin + cfg.gapH) / (cfg.panelW + cfg.gapH));
        const rows = Math.floor((NAMETAG_LANDSCAPE_H[fmt] - 2 * cfg.margin + cfg.gapV) / (cfg.panelH + cfg.gapV));
        expect(cols).toBe(4);
        expect(rows).toBe(2);
      });

      it('portrait slots are taller than wide', () => {
        expect(cfg.panelH).toBeGreaterThan(cfg.panelW);
      });
    });
  }
});

// Portrait page, 2 cols x 4 rows = 4 nametag pairs. Slots sized for 90x55mm badge holders
// with ~2mm clearance. Both paper formats share them: the holder dictates the card size.

const NAMETAG_PORTRAIT_W = { LETTER: 612, A4: 595 };
const NAMETAG_PORTRAIT_H = { LETTER: 792, A4: 842 };

// 90mm × 55mm interior = 255pt × 156pt. Card leaves ~2mm clearance per edge.
const HOLDER_INTERIOR_W = 255;  // 90mm in pt
const HOLDER_INTERIOR_H = 156;  // 55mm in pt

const NAMETAG_H_CONFIGS = {
  LETTER: { panelW: 244, panelH: 147, margin: 15, gapH: 10, gapV: 10 },
  A4:     { panelW: 244, panelH: 147, margin: 15, gapH: 10, gapV: 10 },
} as const;

describe('Nametag horizontal layout geometry', () => {
  for (const fmt of ['LETTER', 'A4'] as const) {
    const cfg = NAMETAG_H_CONFIGS[fmt];

    describe(fmt, () => {
      it('2 slots fit horizontally within portrait page width', () => {
        const usedW = 2 * cfg.panelW + cfg.gapH + 2 * cfg.margin;
        expect(usedW).toBeLessThanOrEqual(NAMETAG_PORTRAIT_W[fmt]);
      });

      it('4 rows fit vertically within portrait page height', () => {
        const usedH = 4 * cfg.panelH + 3 * cfg.gapV + 2 * cfg.margin;
        expect(usedH).toBeLessThanOrEqual(NAMETAG_PORTRAIT_H[fmt]);
      });

      it('at least 2 cols and 4 rows fit per page (8 slots = 4 pairs)', () => {
        const cols = Math.floor((NAMETAG_PORTRAIT_W[fmt] - 2 * cfg.margin + cfg.gapH) / (cfg.panelW + cfg.gapH));
        const rows = Math.floor((NAMETAG_PORTRAIT_H[fmt] - 2 * cfg.margin + cfg.gapV) / (cfg.panelH + cfg.gapV));
        expect(cols).toBeGreaterThanOrEqual(2);
        expect(rows).toBeGreaterThanOrEqual(4);
      });

      it('landscape slots are wider than tall', () => {
        expect(cfg.panelW).toBeGreaterThan(cfg.panelH);
      });

      it('card width fits inside badge holder interior (90mm = 255pt)', () => {
        expect(cfg.panelW).toBeLessThan(HOLDER_INTERIOR_W);
      });

      it('card height fits inside badge holder interior (55mm = 156pt)', () => {
        expect(cfg.panelH).toBeLessThan(HOLDER_INTERIOR_H);
      });
    });
  }
});

// Header text fit
// Standard Helvetica AFM glyph widths (1/1000 em units).
// Accented variants share the width of their base glyph.
const HW: Record<string, number> = {
  A:667,B:667,C:667,D:722,E:611,F:611,G:722,H:722,I:278,J:500,K:667,L:611,
  M:833,N:722,O:722,P:611,Q:722,R:667,S:556,T:611,U:722,V:667,W:944,X:667,
  Y:611,Z:611,
  a:556,b:556,c:500,d:556,e:556,f:278,g:556,h:556,i:222,j:222,k:500,l:222,
  m:833,n:556,o:556,p:556,q:556,r:333,s:500,t:278,u:556,v:500,w:722,x:500,
  y:500,z:500,
  // accented (same width as base)
  À:667,Â:667,Ä:667,È:611,É:611,Ê:611,Ë:611,Î:278,Ï:278,Ô:722,Ö:722,Ù:722,
  Û:722,Ü:722,Ç:667,Ñ:722,
  à:556,â:556,ä:556,è:556,é:556,ê:556,ë:556,î:222,ï:222,ô:556,ö:556,ù:556,
  û:556,ü:556,ç:500,ñ:556,
  á:556,ã:556,í:222,ó:556,ú:556,
  ' ':278,'-':333,'_':556,':':278,'!':278,'?':556,' ':278,
  "'":191,'(':333,')':333,',':278,'.':278,'/':278,'<':584,
  // Digits (all 556 in Helvetica) - group and station labels are full of them.
  '0':556,'1':556,'2':556,'3':556,'4':556,'5':556,'6':556,'7':556,'8':556,'9':556,
};

// An untabulated glyph measures as the widest Helvetica glyph (W, 944), so a translation
// introducing an unlisted character errs towards failing rather than silently passing.
const UNKNOWN_GLYPH_W = 944;

function helveticaWidth(text: string, fontSize: number): number {
  let w = 0;
  for (const ch of text) w += ((HW[ch] ?? UNKNOWN_GLYPH_W) / 1000) * fontSize;
  return w;
}

// Max text width across all newline-separated lines in a string
function maxLineWidth(text: string, fontSize: number): number {
  return Math.max(...text.split('\n').map(l => helveticaWidth(l, fontSize)));
}

// Layout constants (must stay in sync with ScorecardDocument.tsx)
const CARD_W        = 257;   // pt, from CONFIGS.LETTER
const CARD_BORDER   = 1.5;   // pt
const CARD_PAD_H    = 3;     // pt
const TABLE_BORDER  = 1;     // pt (borderLeft on table)
const CELL_BORDER   = 1;     // pt (borderRight on cell)
const HEADER_FONT   = 5.5;   // pt

const CARD_CONTENT_W  = CARD_W - 2 * CARD_BORDER - 2 * CARD_PAD_H;   // 248pt
const TABLE_CONTENT_W = CARD_CONTENT_W - TABLE_BORDER;                  // 247pt

const COL_FRAC = { scrambler: 0.13, attempt: 0.10, result: 0.52, judge: 0.12, competitor: 0.13 };
// Scramble double-checking variant: extra 12% scramblerCheck column (same width as judge) taken from result (52→40).
const COL_FRAC6 = { scrambler: 0.13, scramblerCheck: 0.12, attempt: 0.10, result: 0.40, judge: 0.12, competitor: 0.13 };

function sum(o: Record<string, number>): number {
  return Object.values(o).reduce((a, b) => a + b, 0);
}

function colContentW(frac: number): number {
  return TABLE_CONTENT_W * frac - CELL_BORDER;
}

// The combos are the real guard: any primary+secondary pair is selectable, and a merged
// header still has to fit its column.
const HEADER_CASES = [
  ...(['en', 'fr', 'es', 'pt'] as const).map((l) => ({ label: l, s: getStrings(l) })),
  ...([['fr', 'en'], ['en', 'fr'], ['es', 'pt'], ['en', 'pt']] as const).map(
    ([p, sec]) => ({ label: `${p}+${sec}`, s: getStrings(p, sec) }),
  ),
];

describe('Scorecard header labels fit within their columns', () => {
  for (const { label, s } of HEADER_CASES) {
    describe(`language: ${label}`, () => {
      it('competitor label fits', () => {
        expect(maxLineWidth(s.competitor, HEADER_FONT)).toBeLessThanOrEqual(colContentW(COL_FRAC.competitor));
      });
      it('scrambler label fits', () => {
        expect(maxLineWidth(s.scrambler, HEADER_FONT)).toBeLessThanOrEqual(colContentW(COL_FRAC.scrambler));
      });
      it('judge label fits', () => {
        expect(maxLineWidth(s.judge, HEADER_FONT)).toBeLessThanOrEqual(colContentW(COL_FRAC.judge));
      });
      it('attempt label fits', () => {
        expect(maxLineWidth(s.attempt, HEADER_FONT)).toBeLessThanOrEqual(colContentW(COL_FRAC.attempt));
      });
      it('scramblerCheck label fits (double-checking column)', () => {
        expect(maxLineWidth(s.scramblerCheck, HEADER_FONT)).toBeLessThanOrEqual(colContentW(COL_FRAC6.scramblerCheck));
      });
    });
  }
});

describe('Scorecard column widths sum to the full table width', () => {
  it('5-column layout sums to 1.0', () => {
    expect(sum(COL_FRAC)).toBeCloseTo(1.0, 10);
  });
  it('6-column (double-check) layout sums to 1.0', () => {
    expect(sum(COL_FRAC6)).toBeCloseTo(1.0, 10);
  });
  it('the double-check column takes its width entirely from result (others unchanged)', () => {
    expect(COL_FRAC6.scrambler).toBe(COL_FRAC.scrambler);
    expect(COL_FRAC6.attempt).toBe(COL_FRAC.attempt);
    expect(COL_FRAC6.judge).toBe(COL_FRAC.judge);
    expect(COL_FRAC6.competitor).toBe(COL_FRAC.competitor);
    // scramblerCheck matches judge width (not scrambler - keeps the column compact)
    expect(COL_FRAC6.scramblerCheck).toBe(COL_FRAC.judge);
    expect(COL_FRAC6.result).toBeCloseTo(COL_FRAC.result - COL_FRAC6.scramblerCheck, 10);
  });
  it('result stays positive with room for content in the 6-column layout', () => {
    expect(colContentW(COL_FRAC6.result)).toBeGreaterThan(50);
  });
});

// styles.coverGroup is a FIXED 19pt with no autosizing, and coverCard has no
// `overflow: 'hidden'`, so a long translation prints past the card edge into the cut gutter.
describe('Cover card allGroups line fits the card', () => {
  const COVER_PAD_H = 14;       // styles.coverCard paddingHorizontal
  const COVER_GROUP_FONT = 19;  // styles.coverGroup fontSize
  const BOLD_FACTOR = 1.08;     // coverGroup renders in Helvetica-Bold
  // A4 cards (249pt) are narrower than LETTER (257pt), so they are the binding case.
  const A4_CARD_W = 249;
  const coverContentW = A4_CARD_W - 2 * CARD_BORDER - 2 * COVER_PAD_H;

  for (const lc of ['en', 'fr', 'es', 'pt'] as const) {
    // Far beyond any real competition: a safe upper bound.
    for (const n of [1, 2, 9, 99]) {
      it(`${lc}, n=${n}: "${getStrings(lc).cover.allGroups(n)}" fits`, () => {
        const w = helveticaWidth(getStrings(lc).cover.allGroups(n), COVER_GROUP_FONT) * BOLD_FACTOR;
        expect(w).toBeLessThanOrEqual(coverContentW);
      });
    }
  }
});

// Same card, regular weight: the timing line under the group label must stay on one line.
describe('Cover card timing line fits the card', () => {
  const COVER_TIMING_FONT = 8.5; // styles.coverTiming fontSize
  const coverContentW = 249 - 2 * CARD_BORDER - 2 * 14;
  for (const lc of ['en', 'fr', 'es', 'pt'] as const) {
    it(`${lc}: "${getStrings(lc).cover.timing('10:30', '11:15')}" fits`, () => {
      expect(helveticaWidth(getStrings(lc).cover.timing('10:30', '11:15'), COVER_TIMING_FONT))
        .toBeLessThanOrEqual(coverContentW);
    });
  }
});

// "Hide WCA Live ID" is for blank and extra cards, where the line prints a dangling
// "WCA Live:". It must never strip the ID off a card with a competitor on it.
describe('WCA Live line visibility', () => {
  it('prints on a named card whether or not the setting is on', () => {
    expect(showLiveIdLine(false, '42')).toBe(true);
    expect(showLiveIdLine(true, '42')).toBe(true);
  });

  it('prints the empty label on a blank card by default (matches the original PDFs)', () => {
    expect(showLiveIdLine(false, '')).toBe(true);
  });

  it('is suppressed only on blank cards when the setting is on', () => {
    expect(showLiveIdLine(true, '')).toBe(false);
  });
});
