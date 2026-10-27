import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import { parseWCIF } from '../lib/wcif-parser';
import { sampleWcif, testSettings } from '../test/fixtures';
import { hasPdftotext, pdfWords } from '../test/pdfFiles';
import { NametTagDocument } from './NametTagDocument';
import { NAMETAG_H, NAMETAG_PANEL_BORDER, nametagHPositions } from './layoutConstants';
import type { NametTagLogoMode } from '../types/settings';

// Measured off the real render: what the badge holder and the pair's alignment depend on.
describe.skipIf(!hasPdftotext && !process.env.CI)('horizontal name tag render', () => {
  const render = async (nametagLogoMode: NametTagLogoMode, name?: string) => {
    const settings = testSettings({ nametagLayout: 'horizontal', nametagLogoMode, useDefaultLogo: true, language: 'fr', secondaryLanguage: 'en' });
    const [first, ...rest] = parseWCIF(sampleWcif(), settings).nametags;
    const nametags = [{ ...first!, name: name ?? first!.name, wcaId: '2017ONDE01' }, ...rest];
    return pdfWords(await renderToBuffer(createElement(NametTagDocument, { nametags, settings }) as never));
  };
  const word = (words: ReturnType<typeof pdfWords>, text: string) => words.filter(w => w.text === text);
  // First pair only: the front sits left of the page centre, the back right.
  const firstPair = (words: ReturnType<typeof pdfWords>) => words.filter(w => w.yMax < nametagHPositions('LETTER')[2]!.top);
  const badge = (words: ReturnType<typeof pdfWords>, back: boolean) =>
    firstPair(words).find(w => /^[A-ZÉ]{4,}$/.test(w.text) && (w.xMin > 306) === back)!;

  it.each(['hidden', 'with-name', 'logo-only'] as const)('%s: front and back badges share a Y', async (mode) => {
    const words = await render(mode, 'André Rodrigo César Pinheiro Monte Amado');
    expect(badge(words, true).yMin).toBeCloseTo(badge(words, false).yMin, 1);
  });

  it.each(['hidden', 'with-name', 'logo-only'] as const)('%s: QR labels are Schedule / Results, in the back language', async (mode) => {
    const words = await render(mode);
    expect(word(words, 'Schedule').length).toBeGreaterThan(0);
    expect(word(words, 'Results').length).toBeGreaterThan(0);
  });

  it('two-line names keep the WCA ID clear of the badge and the QR labels on the card', async () => {
    const words = await render('with-name', 'André Rodrigo César Pinheiro Monte Amado');
    const [id] = word(words, '2017ONDE01');
    const [label] = firstPair(words).filter(w => w.text === 'Schedule');
    expect(id!.yMin - badge(words, true).yMax).toBeGreaterThan(4);
    expect(label!.yMax).toBeLessThan(nametagHPositions('LETTER')[0]!.top + NAMETAG_H.panelH - NAMETAG_PANEL_BORDER);
  });
});
