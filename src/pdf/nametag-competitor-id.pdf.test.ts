import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import { parseWCIF } from '../lib/wcif-parser';
import { sampleWcif, testSettings } from '../test/fixtures';
import { hasPdftotext, pdfWords } from '../test/pdfFiles';
import { NametTagDocument } from './NametTagDocument';
import { NAMETAG_CONFIGS, NAMETAG_H, nametagHPositions } from './layoutConstants';
import type { NametTagLayout } from '../types/settings';

// The widest line a big championship prints: a 5-digit competitor ID beside a WCA ID, under a long team label.
describe.skipIf(!hasPdftotext && !process.env.CI)('name tag competitor ID and custom badge', () => {
  it.each(['vertical', 'horizontal'] as NametTagLayout[])('%s: both stay inside the back card', async (nametagLayout) => {
    const settings = testSettings({ nametagLayout, nametagCompetitorId: true, paperFormat: 'LETTER' });
    const [first] = parseWCIF(sampleWcif(), settings).nametags;
    const label = 'SCORETAKING TEAM LEAD';
    const tag = { ...first!, wcaId: '2017WWWW01', competitorId: 88888, titleFront: label, titleBack: label };
    const words = pdfWords(await renderToBuffer(createElement(NametTagDocument, { nametags: [tag], settings }) as never));

    const back = nametagLayout === 'horizontal'
      ? { left: nametagHPositions('LETTER')[1]!.left, w: NAMETAG_H.panelW }
      : { left: NAMETAG_CONFIGS.LETTER.margin + NAMETAG_CONFIGS.LETTER.panelW + NAMETAG_CONFIGS.LETTER.gapH, w: NAMETAG_CONFIGS.LETTER.panelW };
    const onBack = words.filter(w => w.xMin >= back.left - 1 && w.xMin < back.left + back.w);
    for (const text of ['88888', 'LEAD', '2017WWWW01']) {
      const w = onBack.find(x => x.text === text);
      expect(w, `"${text}" on the back card`).toBeDefined();
      expect(w!.xMax).toBeLessThan(back.left + back.w);
    }
  });

  it.each(['vertical', 'horizontal'] as NametTagLayout[])('%s: an overlong badge stays on one line', async (nametagLayout) => {
    const settings = testSettings({ nametagLayout, paperFormat: 'LETTER' });
    const [first] = parseWCIF(sampleWcif(), settings).nametags;
    const label = 'INTERNATIONAL BROADCAST AND STREAM PRODUCTION TEAM LEAD';
    const tag = { ...first!, titleFront: label, titleBack: label };
    const words = pdfWords(await renderToBuffer(createElement(NametTagDocument, { nametags: [tag], settings }) as never));
    const badgeRows = new Set(words.filter(w => w.text === 'INTERNATIONAL').map(w => Math.round(w.yMin)));
    const isBadgeWord = (text: string) => {
      const start = text.replace('…', '');
      return start !== '' && label.split(' ').some(l => l.startsWith(start));
    };
    const offRow = words.filter(w => isBadgeWord(w.text) && !badgeRows.has(Math.round(w.yMin)));
    expect(offRow.map(w => w.text)).toEqual([]);
  });

  it('no competitor ID on the entry: no ID line', async () => {
    const settings = testSettings({ paperFormat: 'LETTER' });
    const [first] = parseWCIF(sampleWcif(), settings).nametags;
    const words = pdfWords(await renderToBuffer(createElement(NametTagDocument, { nametags: [first!], settings }) as never));
    expect(words.filter(w => w.text === 'ID:')).toEqual([]);
  });
});
