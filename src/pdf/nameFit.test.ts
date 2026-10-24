import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import * as fontkit from 'fontkit';
import {
  textWidth, nameBox, nameLayout, nametagName, nametagNameW,
  NAME_LINE_HEIGHT, NAME_MAX_FS, NAME_MIN_FS, NAMETAG_NAME_MAX_FS,
} from './nameFit';
import {
  NAMETAG_CONFIGS, PDF_FONT, PDF_FONT_BOLD, PDF_FONT_BOLD_EXT, PDF_FONT_EXT,
  SCORECARD_CONFIGS, nametagNameH,
} from './layoutConstants';
import { corpus } from '../test/corpus';
import { randomWcif } from '../test/wcifGen';
import { printedName } from '../lib/wcif-parser';

const LONG = 'André Rodrigo César Pinheiro Monte Amado';
const lines = (text: string) => text.split('\n');

describe('Name widths and fonts', () => {
  it('measures Helvetica-Bold, folding accents to their base glyph', () => {
    expect(textWidth('é', 1000)).toBe(556);
    expect(textWidth('Wm', 1000)).toBe(944 + 889);
  });

  const font = (style: string) =>
    fontkit.openSync(fileURLToPath(new URL(`./fonts/scorecard-sans-${style}.otf`, import.meta.url))) as fontkit.Font;

  it.each(['regular', 'bold'])('every measured %s width matches the embedded Helvetica clone', (style) => {
    const f = font(style);
    const latin = [[0x20, 0x24f], [0x1ea0, 0x1ef9]].flatMap(([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => a + i));
    for (const cp of latin.filter(cp => f.hasGlyphForCodePoint(cp))) {
      const c = String.fromCodePoint(cp);
      const w = textWidth(c, 1000, style === 'bold');
      if (w !== 1000) expect([c, w]).toEqual([c, f.glyphForCodePoint(cp).advanceWidth]);
    }
  });

  it.each(['regular', 'bold'])('embedded %s font has built-in Helvetica\'s line box, or slip rows drop it', (style) => {
    const f = font(style);
    expect([f.ascent, f.descent, f.lineGap]).toEqual([900, -200, 0]);
  });

  // react-pdf picks the first family per glyph, so Helvetica stays first and nothing embeds
  // unless a letter needs the clone.
  it('falls back from Helvetica to the embedded clone', () => {
    expect(PDF_FONT).toEqual(['Helvetica', PDF_FONT_EXT]);
    expect(PDF_FONT_BOLD).toEqual(['Helvetica-Bold', PDF_FONT_BOLD_EXT]);
  });

  it('a decomposed name lays out as its composed form', () => {
    const nfd = 'Nguyễn Phương'.normalize('NFD');
    expect(nameLayout(nfd, 200, 40).text).toBe('Nguyễn Phương');
  });
});

describe('Scorecard name fits the header', () => {
  const boxes = Object.entries(SCORECARD_CONFIGS).flatMap(([fmt, cfg]) =>
    [true, false].flatMap(hasLogo => [true, false].map(withCompName => ({
      label: `${fmt} logo=${hasLogo} compName=${withCompName}`,
      box: nameBox(cfg.cardW, hasLogo, withCompName),
    }))));

  it.each(boxes)('$label: a long name wraps to two readable lines that fit', ({ box }) => {
    const { text, fontSize } = nameLayout(LONG, box.w, box.h);
    expect(lines(text)).toHaveLength(2);
    expect(fontSize).toBeGreaterThanOrEqual(12);
    for (const l of lines(text)) expect(textWidth(l, fontSize)).toBeLessThanOrEqual(box.w);
    expect(2 * fontSize * NAME_LINE_HEIGHT).toBeLessThanOrEqual(box.h);
  });

  it.each(boxes)('$label: a short name stays on one line at full size', ({ box }) => {
    expect(nameLayout('Ali Hakim', box.w, box.h)).toEqual({ text: 'Ali Hakim', fontSize: NAME_MAX_FS });
  });

  // The originals print 13pt+ names on one line; wrapping those would drift from them.
  it('a name that reads fine on one line is not wrapped for a small gain', () => {
    const box = nameBox(SCORECARD_CONFIGS.LETTER.cardW, false, false);
    expect(nameLayout('Alexandre Beaulieu-Gagnon', box.w, box.h)).toEqual({ text: 'Alexandre Beaulieu-Gagnon', fontSize: 15.5 });
  });

  it('a hyphenated name can break after the hyphen', () => {
    const box = nameBox(SCORECARD_CONFIGS.LETTER.cardW, true, true);
    expect(nameLayout('Ana Żółtowska-Świętochowska', box.w, box.h).text).toBe('Ana Żółtowska-\nŚwiętochowska');
  });

  it('a name without spaces only shrinks, never below the floor', () => {
    const box = nameBox(SCORECARD_CONFIGS.A4.cardW, true, true);
    const { text, fontSize } = nameLayout('W'.repeat(60), box.w, box.h);
    expect(text).not.toContain('\n');
    expect(fontSize).toBe(NAME_MIN_FS);
  });
});

describe('Vertical name tag name', () => {
  const cases = Object.entries(NAMETAG_CONFIGS).flatMap(([fmt, { panelW }]) =>
    (['hidden', 'with-name', 'logo-only'] as const).map(mode => ({
      label: `${fmt} ${mode}`, panelW, h: nametagNameH(mode),
    })));

  it.each(cases)('$label: a long name splits over two lines that fit above the badge', ({ panelW, h }) => {
    for (const name of ['Juan Nicolás Pinzón Martínez', 'Łukasz Żółtowski-Świętochowski', LONG]) {
      const { text, fontSize } = nametagName(name, panelW, h, false);
      expect(lines(text)).toHaveLength(2);
      expect(fontSize).toBeGreaterThanOrEqual(14);
      for (const l of lines(text)) expect(textWidth(l, fontSize, false)).toBeLessThanOrEqual(nametagNameW(panelW));
      expect(2 * fontSize * NAME_LINE_HEIGHT).toBeLessThanOrEqual(h);
    }
  });

  // Wrapping takes a 2pt gain, so a longer name can only out-size a shorter one by less.
  it.each(cases)('$label: one more letter never prints a name noticeably bigger', ({ panelW, h }) => {
    const short = nametagName('Jean-Philippe Beaulieu-Roy', panelW, h, false);
    const long = nametagName('Jean-Philippe Beaulieu-Roys', panelW, h, false);
    expect(long.fontSize - short.fontSize).toBeLessThan(2);
  });

  it.each(cases)('$label: a short name keeps the original one-line size', ({ panelW, h }) => {
    expect(nametagName('Ali Hakim', panelW, h, false)).toEqual({ text: 'Ali Hakim', fontSize: NAMETAG_NAME_MAX_FS });
  });

  it('compact tags stay on one line', () => {
    expect(nametagName(LONG, 244, 40, true).text).toBe(LONG);
  });
});

// Over every name in the real corpus and the generator's hard ones (long, accented, Vietnamese,
// astral-plane): whatever size and break the layout picks must fit the box it is drawn in.
describe('every real name fits', () => {
  const names = [...new Set([
    ...corpus().map(([, w]) => w),
    ...Array.from({ length: 30 }, (_, i) => randomWcif(i + 1)),
  ].flatMap(w => w.persons.map(p => printedName(p.name))))];
  const widest = (text: string, fs: number, bold: boolean) => Math.max(...lines(text).map(l => textWidth(l, fs, bold)));

  it.each(Object.entries(SCORECARD_CONFIGS))('its %s scorecard name box', (_paper, cfg) => {
    const box = nameBox(cfg.cardW, true, false);
    const over = names.filter((n) => {
      const r = nameLayout(n, box.w, box.h);
      return r.fontSize > NAME_MIN_FS && widest(r.text, r.fontSize, true) > box.w + 0.01;
    });
    expect(over).toEqual([]);
  });

  it.each(Object.entries(NAMETAG_CONFIGS))('its %s name tag panel', (_paper, cfg) => {
    // The panel's inner width: what is left after its 7pt padding and 1.5pt border a side.
    const inner = cfg.panelW - 2 * (7 + 1.5);
    const over = names.filter((n) => [false, true].some((compact) => {
      const r = nametagName(n, cfg.panelW, nametagNameH('with-name'), compact);
      return widest(r.text, r.fontSize, false) > inner;
    }));
    expect(over).toEqual([]);
  });
});
