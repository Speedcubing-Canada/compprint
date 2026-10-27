import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import { parseWCIF } from '../lib/wcif-parser';
import { sampleWcif, testSettings } from '../test/fixtures';
import { hasPdftotext, pdfWords } from '../test/pdfFiles';
import { NametTagDocument } from './NametTagDocument';
import { NAMETAG_H, NAMETAG_PANEL_BORDER, nametagHPositions } from './layoutConstants';
import type { CompetitionSettings, NametTagLogoMode } from '../types/settings';

const MODES = ['hidden', 'with-name', 'logo-only'] as const;
const [front, back, below] = [0, 1, 2].map(i => nametagHPositions('LETTER')[i]!);

// Measured off the real render: what the badge holder and the pair's alignment depend on.
describe.skipIf(!hasPdftotext && !process.env.CI)('horizontal name tag render', () => {
  const render = async (nametagLogoMode: NametTagLogoMode, over: Partial<CompetitionSettings> = {}) => {
    const settings = testSettings({
      nametagLayout: 'horizontal', nametagLogoMode, useDefaultLogo: true, language: 'fr', secondaryLanguage: 'en', ...over,
    });
    const [first, ...rest] = parseWCIF(sampleWcif(), settings).nametags;
    const tag = { ...first!, name: 'André Rodrigo César Pinheiro Monte Amado', wcaId: '2017ONDE01' };
    const words = pdfWords(await renderToBuffer(createElement(NametTagDocument, { nametags: [tag, ...rest], settings }) as never));
    // First pair only: front card left, back card right.
    const pair = words.filter(w => w.yMax < below.top);
    const on = (card: typeof front) => pair.filter(w => w.xMin >= card.left && w.xMax <= card.left + NAMETAG_H.panelW);
    return { tag, front: on(front), back: on(back) };
  };
  const find = (words: { text: string }[], text: string) => {
    const w = words.find(x => x.text === text);
    expect(w, `"${text}" on the card`).toBeDefined();
    return w as ReturnType<typeof pdfWords>[number];
  };

  it.each(MODES)('%s: front and back badges share a Y', async (mode) => {
    const { tag, front, back } = await render(mode);
    expect(find(back, tag.titleBack).yMin).toBeCloseTo(find(front, tag.titleFront).yMin, 1);
  });

  it.each(MODES)('%s: a two-line name keeps the WCA ID clear of the badge and the labels on the card', async (mode) => {
    const { tag, back } = await render(mode);
    expect(find(back, '2017ONDE01').yMin - find(back, tag.titleBack).yMax).toBeGreaterThan(4);
    expect(find(back, 'Schedule').yMax).toBeLessThan(front.top + NAMETAG_H.panelH - NAMETAG_PANEL_BORDER);
  });

  it('QR labels follow each side: primary language on the front, secondary on the back', async () => {
    const { front, back } = await render('hidden', { nametagQrMode: 'both-sides' });
    find(front, 'Horaire');
    find(front, 'Résultats');
    find(back, 'Schedule');
    find(back, 'Results');
    expect(back.some(w => w.text === 'Horaire')).toBe(false);
  });
});
