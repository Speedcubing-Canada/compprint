import { describe, it, expect } from 'vitest';
import {
  GROUP_OVERVIEW_FLEX, GROUP_OVERVIEW as G,
  groupBlockHeight, estimateGroupOverviewPages, groupBlockFitsPage,
} from './layoutConstants';
import { getGroupOverviewStrings } from '../lib/i18n';
import type { LocaleCode, PaperFormat } from '../types/settings';
import { COLUMNS, groupBlockRows, visibleColumns } from './groupOverviewColumns';

// Same Helvetica AFM width table as checking-sheet-layout.test.ts. An untabulated glyph
// measures as the widest one (W, 944), so a new translation errs towards failing.
const HW: Record<string, number> = {
  A:667,B:667,C:667,D:722,E:611,F:611,G:722,H:722,I:278,J:500,K:667,L:611,
  M:833,N:722,O:722,P:611,Q:722,R:667,S:556,T:611,U:722,V:667,W:944,X:667,
  Y:611,Z:611,
  a:556,b:556,c:500,d:556,e:556,f:278,g:556,h:556,i:222,j:222,k:500,l:222,
  m:833,n:556,o:556,p:556,q:556,r:333,s:500,t:278,u:556,v:500,w:722,x:500,
  y:500,z:500,
  À:667,Â:667,Ä:667,È:611,É:611,Ê:611,Ë:611,Î:278,Ï:278,Ô:722,Ö:722,Ù:722,
  Û:722,Ü:722,Ç:667,Ñ:722,
  à:556,â:556,ä:556,è:556,é:556,ê:556,ë:556,î:222,ï:222,ô:556,ö:556,ù:556,
  û:556,ü:556,ç:500,ñ:556,
  á:556,ã:556,í:222,ó:556,ú:556,
  ' ':278,'-':333,'_':556,':':278,'.':278,'(':333,')':333,
  "'":191,',':278,'/':278,'<':584,
  '0':556,'1':556,'2':556,'3':556,'4':556,'5':556,'6':556,'7':556,'8':556,'9':556,
};
const UNKNOWN_GLYPH_W = 944;
const BOLD_FACTOR = 1.08;

const width = (text: string, fontSize: number, bold: boolean) => {
  let w = 0;
  for (const ch of text) w += ((HW[ch] ?? UNKNOWN_GLYPH_W) / 1000) * fontSize * (bold ? BOLD_FACTOR : 1);
  return w;
};

// Must stay in sync with GroupOverviewDocument.tsx.
const PAGE_W: Record<PaperFormat, number> = { LETTER: 612, A4: 595.28 };
const PAGE_H: Record<PaperFormat, number> = { LETTER: 792, A4: 842 };
const TABLE_BORDER = 0.75;  // styles.table border
const CELL_PAD_H   = 5;     // cellStyle paddingHorizontal, both sides
const CELL_BORDER  = 0.5;   // cellStyle borderRight (BORDER_INNER)
const HEADER_FONT  = 8;     // styles.headerText fontSize

const LOCALES: LocaleCode[] = ['en', 'fr', 'es', 'pt'];
const FORMATS: PaperFormat[] = ['LETTER', 'A4'];

const TOTAL_FLEX = Object.values(GROUP_OVERVIEW_FLEX).reduce((a, b) => a + b, 0);

function colContentW(flex: number, format: PaperFormat): number {
  const tableW = PAGE_W[format] - 2 * G.pagePadH - 2 * TABLE_BORDER;
  return tableW * (flex / TOTAL_FLEX) - 2 * CELL_PAD_H - CELL_BORDER;
}

describe('Group Overview column widths', () => {
  it('declares a flex for every rendered column', () => {
    expect(Object.keys(GROUP_OVERVIEW_FLEX).sort()).toEqual(COLUMNS.map(c => c.key).sort());
  });

  it('gives competitors and judges the most room - they hold the longest lists', () => {
    expect(GROUP_OVERVIEW_FLEX.competitors).toBeGreaterThan(GROUP_OVERVIEW_FLEX.scramblers);
    expect(GROUP_OVERVIEW_FLEX.judges).toBeGreaterThan(GROUP_OVERVIEW_FLEX.runners);
  });

  // Headers print as "Competitors (14)", so the count is part of what has to fit. Three
  // digits covers any group a WCA competition can schedule.
  for (const format of FORMATS) {
    for (const lc of LOCALES) {
      it(`${format} / ${lc}: every column header and its count fit`, () => {
        const strings = getGroupOverviewStrings(lc);
        for (const col of COLUMNS) {
          const text = `${col.label(strings)} (999)`;
          const w = width(text, HEADER_FONT, true);
          const avail = colContentW(GROUP_OVERVIEW_FLEX[col.key], format);
          expect(w).toBeLessThanOrEqual(avail);
        }
      });
    }
  }

  // A 4-line name at 9pt is ~150pt wide; the narrow staff columns are the binding case.
  for (const format of FORMATS) {
    it(`${format}: a long competitor name fits the narrowest column`, () => {
      const name = 'Christopher Cervania';
      const narrowest = Math.min(...Object.values(GROUP_OVERVIEW_FLEX));
      expect(width(name, G.fontSize, false)).toBeLessThanOrEqual(colContentW(narrowest, format));
    });
  }
});

describe('Group Overview page estimate', () => {
  it('grows with the tallest column, not the total', () => {
    expect(groupBlockHeight(14, false)).toBeGreaterThan(groupBlockHeight(6, false));
    expect(groupBlockHeight(6, true)).toBeGreaterThan(groupBlockHeight(6, false));
  });

  it('no groups means no pages', () => {
    expect(estimateGroupOverviewPages([], 'A4')).toBe(0);
  });

  it('a handful of small groups stays on one page', () => {
    const blocks = Array.from({ length: 3 }, () => ({ rows: 6, withDayLabel: false }));
    expect(estimateGroupOverviewPages(blocks, 'A4')).toBe(1);
  });

  // The real failure mode: blocks are wrap={false}, so a page holds whole blocks only and
  // a fixed +1 (what the schedule and checklist use) would under-report badly.
  it('spills onto further pages once the blocks stop fitting', () => {
    const blocks = Array.from({ length: 20 }, () => ({ rows: 14, withDayLabel: false }));
    const usable = PAGE_H.A4 - 2 * G.pagePadV;
    const perPage = Math.floor(usable / groupBlockHeight(14, false));
    const pages = estimateGroupOverviewPages(blocks, 'A4');
    expect(perPage).toBeGreaterThan(0);
    // The title block can cost page one a block, never more than that.
    expect(pages).toBeGreaterThanOrEqual(Math.ceil(20 / perPage));
    expect(pages).toBeLessThanOrEqual(Math.ceil(20 / perPage) + 1);
  });

  it('LETTER fits fewer blocks per page than A4', () => {
    const blocks = Array.from({ length: 30 }, () => ({ rows: 10, withDayLabel: false }));
    expect(estimateGroupOverviewPages(blocks, 'LETTER'))
      .toBeGreaterThanOrEqual(estimateGroupOverviewPages(blocks, 'A4'));
  });
});

describe('Group Overview visible columns', () => {
  const entry = (over: Partial<Record<'competitors' | 'scramblers' | 'runners' | 'judges', string[]>> = {}) =>
    ({ competitors: [], scramblers: [], runners: [], judges: [], ...over });

  it('keeps every column when each is used somewhere', () => {
    const entries = [entry({ competitors: ['A'], scramblers: ['B'] }), entry({ runners: ['C'], judges: ['D'] })];
    expect(visibleColumns(entries).map(c => c.key))
      .toEqual(['competitors', 'scramblers', 'runners', 'judges']);
  });

  // The pre-assignment case: groups exist, nobody is staffed yet.
  it('drops all three staff columns when nothing is assigned', () => {
    const entries = [entry({ competitors: ['A'] }), entry({ competitors: ['B'] })];
    expect(visibleColumns(entries).map(c => c.key)).toEqual(['competitors']);
  });

  it('keeps a staff column used by any one group, not only by all of them', () => {
    const entries = [entry({ competitors: ['A'] }), entry({ competitors: ['B'], judges: ['C'] })];
    expect(visibleColumns(entries).map(c => c.key)).toEqual(['competitors', 'judges']);
  });

  it('keeps the competitor column even when every group is empty', () => {
    expect(visibleColumns([entry()]).map(c => c.key)).toEqual(['competitors']);
  });
});

// A name wider than its cell wraps, and the block grows by a line. Counting names instead
// undercounted the estimate by a page on real competitions.
describe('Group Overview row count', () => {
  const long = 'Maria da Conceição Albuquerque de Oliveira Santos Ferreira';
  const group = { competitors: [long, 'Ana Lima', 'Bo Chen'], scramblers: ['A'], runners: ['B'], judges: ['C', 'D', 'E'] };

  it('counts a wrapped name as two lines', () => {
    expect(groupBlockRows(group, visibleColumns([group]), 'LETTER')).toBe(4);
  });

  it('does not wrap once the staff columns are gone and the cell is wide', () => {
    const solo = { ...group, scramblers: [], runners: [], judges: [] };
    expect(groupBlockRows(solo, visibleColumns([solo]), 'LETTER')).toBe(3);
  });
});

// react-pdf squashes an oversized wrap={false} block instead of paginating it, which is what
// the README's Round Checklist note is about. The document only pins blocks that fit a page.
describe('Group Overview oversized blocks', () => {
  it('pins an ordinary group', () => {
    expect(groupBlockFitsPage(20, true, 'LETTER')).toBe(true);
  });

  it('lets a group too tall for any page break instead of being squashed', () => {
    const usable = PAGE_H.LETTER - 2 * G.pagePadV;
    const tooMany = Math.ceil(usable / G.lineH) + 1;
    expect(groupBlockFitsPage(tooMany, false, 'LETTER')).toBe(false);
  });

  it('is stricter on LETTER than on A4', () => {
    const usable = PAGE_H.LETTER - 2 * G.pagePadV;
    // A block sized to just overflow LETTER; A4 is 50pt taller, so it still fits there.
    const rows = Math.floor((usable - groupBlockHeight(0, false)) / G.lineH) + 2;
    expect(groupBlockFitsPage(rows, false, 'LETTER')).toBe(false);
    expect(groupBlockFitsPage(rows, false, 'A4')).toBe(true);
  });
});
