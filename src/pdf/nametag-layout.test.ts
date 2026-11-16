import { describe, it, expect } from 'vitest';
import { ICON_GAP, NAMETAG_CONFIGS, NAMETAG_DUTY_LABEL, NAMETAG_H, eventIconsVisible, nametagIconSize, nametagInnerW } from './layoutConstants';
import { textWidth } from './nameFit';
import { getNametTagStrings } from '../lib/i18n';

// On horizontal name tags, event icons appear only on the side WITHOUT the QR codes.
// The vertical layout keeps icons on both sides.
describe('eventIconsVisible', () => {
  it('hides icons on the QR side of a horizontal (compact) tag', () => {
    expect(eventIconsVisible({ isQrSide: true, compact: true })).toBe(false);
  });

  it('keeps icons on the non-QR side of a horizontal tag', () => {
    expect(eventIconsVisible({ isQrSide: false, compact: true })).toBe(true);
  });

  it('keeps icons on both sides of the vertical (non-compact) layout', () => {
    expect(eventIconsVisible({ isQrSide: true, compact: false })).toBe(true);
    expect(eventIconsVisible({ isQrSide: false, compact: false })).toBe(true);
  });
});

// All 17 WCA events fit one icon row on every panel.
describe('nametagIconSize', () => {
  it.each([
    ...Object.entries(NAMETAG_CONFIGS).map(([paper, { panelW }]) => [paper, panelW, false] as const),
    ['horizontal', NAMETAG_H.panelW, true] as const,
  ])('%s: 17 icons fit the row', (_layout, panelW, compact) => {
    const size = nametagIconSize(panelW, 17, compact);
    expect(size).toBeGreaterThan(0);
    expect(17 * (size + 2 * ICON_GAP)).toBeLessThanOrEqual(nametagInnerW(panelW));
  });
});

describe('duty labels', () => {
  it.each(['en', 'fr', 'es', 'pt'] as const)('%s: every label fits its column', (lc) => {
    const s = getNametTagStrings(lc);
    const labels = [s.compete, s.scramble, s.judge, s.run];
    expect(labels.filter(l => textWidth(l, NAMETAG_DUTY_LABEL.fs) > NAMETAG_DUTY_LABEL.w)).toEqual([]);
  });
});
