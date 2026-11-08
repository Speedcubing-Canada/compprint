import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import { parseWCIF } from '../lib/wcif-parser';
import { sampleWcif, testSettings } from '../test/fixtures';
import { hasPdftotext, pdfWords } from '../test/pdfFiles';
import { NametTagDocument } from './NametTagDocument';
import { NAMETAG_CONFIGS, NAMETAG_H, nametagHPositions } from './layoutConstants';
import type { NametTagLayout } from '../types/settings';

// The widest line a big championship prints: a 5-digit Live ID beside a WCA ID, under a long team label.
describe.skipIf(!hasPdftotext && !process.env.CI)('name tag WCA Live ID and custom badge', () => {
  it.each(['vertical', 'horizontal'] as NametTagLayout[])('%s: both stay inside the back card', async (nametagLayout) => {
    const settings = testSettings({ nametagLayout, nametagLiveId: true, paperFormat: 'LETTER' });
    const [first] = parseWCIF(sampleWcif(), settings).nametags;
    const label = 'SCORETAKING TEAM LEAD';
    const tag = { ...first!, wcaId: '2017WWWW01', liveId: '88888', staff: false, titleFront: label, titleBack: label };
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
});
