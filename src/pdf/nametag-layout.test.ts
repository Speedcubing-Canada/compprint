import { describe, it, expect } from 'vitest';
import { ICON_GAP, NAMETAG_CONFIGS, NAMETAG_H, eventIconsVisible, nametagIconSize, nametagInnerW } from './layoutConstants';

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
