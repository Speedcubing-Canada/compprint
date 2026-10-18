import { describe, it, expect } from 'vitest';
import QRCode from 'qrcode';
import { liveQrTarget } from './layoutConstants';
import { qrPathData } from './qrPath';

// The second QR on a name tag is the one an organizer can't check by eye: a wrong id still
// scans, it just lands on the wrong page or a 404. The two live-results systems use unrelated
// competitor ids, so the mapping is what this guards.
const entry = { registrantId: 5, registrationId: 1385268 };

describe('liveQrTarget', () => {
  it('builds an ILR URL from the WCA competition id and the registration id', () => {
    expect(liveQrTarget(
      { mode: 'ilr', competitionId: 'Soorsi2026', wcaLiveId: null, wcaLivePersonIds: null },
      entry,
    )).toEqual({
      url: 'https://www.worldcubeassociation.org/competitions/Soorsi2026/live/competitors/1385268',
      label: 'worldcubeassociation.org',
    });
  });

  it('ignores the WCA Live values in ILR mode - ILR never needs them', () => {
    expect(liveQrTarget(
      { mode: 'ilr', competitionId: 'Soorsi2026', wcaLiveId: '9667', wcaLivePersonIds: { 5: '42' } },
      entry,
    ).url).toContain('/live/competitors/1385268');
  });

  it('builds a WCA Live URL from the numeric competition id and the person id', () => {
    expect(liveQrTarget(
      { mode: 'wca-live', competitionId: 'Soorsi2026', wcaLiveId: '9667', wcaLivePersonIds: { 5: '42' } },
      entry,
    )).toEqual({
      url: 'https://live.worldcubeassociation.org/competitions/9667/competitors/42',
      label: 'live.worldcubeassociation.org',
    });
  });

  it('falls back to the WCA Live home page when either id is missing', () => {
    const home = 'https://live.worldcubeassociation.org';
    expect(liveQrTarget({ mode: 'wca-live', competitionId: 'X', wcaLiveId: null, wcaLivePersonIds: { 5: '42' } }, entry).url).toBe(home);
    expect(liveQrTarget({ mode: 'wca-live', competitionId: 'X', wcaLiveId: '9667', wcaLivePersonIds: null }, entry).url).toBe(home);
    // Registered but not on WCA Live: the map has no row for this competitor.
    expect(liveQrTarget({ mode: 'wca-live', competitionId: 'X', wcaLiveId: '9667', wcaLivePersonIds: { 9: '42' } }, entry).url).toBe(home);
  });

  it('never uses the registrant id in an ILR URL, or the registration id in a WCA Live one', () => {
    const ilr = liveQrTarget({ mode: 'ilr', competitionId: 'X', wcaLiveId: null, wcaLivePersonIds: null }, entry).url;
    const live = liveQrTarget({ mode: 'wca-live', competitionId: 'X', wcaLiveId: '9667', wcaLivePersonIds: { 5: '42' } }, entry).url;
    expect(ilr.endsWith('/5')).toBe(false);
    expect(live).not.toContain('1385268');
  });

  // On-the-spot fill-in tags have no person yet, so they open the competition itself.
  it('sends a blank tag to the competition page in both systems', () => {
    const blank = { registrantId: 0, registrationId: 0, blank: true };
    expect(liveQrTarget({ mode: 'ilr', competitionId: 'Soorsi2026', wcaLiveId: null, wcaLivePersonIds: null }, blank).url)
      .toBe('https://www.worldcubeassociation.org/competitions/Soorsi2026/live');
    expect(liveQrTarget({ mode: 'wca-live', competitionId: 'X', wcaLiveId: '9667', wcaLivePersonIds: { 5: '42' } }, blank).url)
      .toBe('https://live.worldcubeassociation.org/competitions/9667');
    expect(liveQrTarget({ mode: 'wca-live', competitionId: 'X', wcaLiveId: null, wcaLivePersonIds: null }, blank).url)
      .toBe('https://live.worldcubeassociation.org');
  });

  it('sends a non-competing staff tag to the competition page, not a competitor page', () => {
    const staff = { ...entry, staff: true };
    expect(liveQrTarget({ mode: 'ilr', competitionId: 'Soorsi2026', wcaLiveId: null, wcaLivePersonIds: null }, staff).url)
      .toBe('https://www.worldcubeassociation.org/competitions/Soorsi2026/live');
    expect(liveQrTarget({ mode: 'wca-live', competitionId: 'X', wcaLiveId: '9667', wcaLivePersonIds: { 5: '42' } }, staff).url)
      .toBe('https://live.worldcubeassociation.org/competitions/9667');
  });
});

// A path is not eyeball-checkable the way a grid of rects is, so this walks the emitted `d`
// back into a module grid and compares it to the code itself.
describe('qrPathData', () => {
  const url = 'https://www.competitiongroups.com/competitions/Soorsi2026/persons/5';

  function gridFromPath(d: string, n: number): boolean[][] {
    const grid = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
    // Each run is emitted as `M<x> <y>h<w>v1h-<w>z`.
    const re = /M(\d+) (\d+)h(\d+)v1h-(\d+)z/g;
    let m: RegExpExecArray | null;
    let consumed = 0;
    while ((m = re.exec(d)) !== null) {
      const [full, x, y, w, back] = m;
      expect(w).toBe(back);       // the closing edge must retrace the opening one
      consumed += full.length;
      for (let i = 0; i < Number(w); i++) grid[Number(y)][Number(x) + i] = true;
    }
    // Nothing in the path but runs: a stray command would draw something unintended.
    expect(consumed).toBe(d.length);
    return grid;
  }

  it('covers exactly the dark modules of the code', () => {
    const { d, modules } = qrPathData(url);
    const qr = QRCode.create(url, { errorCorrectionLevel: 'M' });
    const data = qr.modules.data as unknown as Uint8Array;

    expect(modules).toBe(qr.modules.size);
    const grid = gridFromPath(d, modules);
    for (let row = 0; row < modules; row++)
      for (let col = 0; col < modules; col++)
        expect(grid[row][col]).toBe(data[row * modules + col] !== 0);
  });

  it('emits one run per horizontal dark run, not one per module', () => {
    const { d, modules } = qrPathData(url);
    const runs = d.match(/M/g)?.length ?? 0;
    const dark = (QRCode.create(url, { errorCorrectionLevel: 'M' })
      .modules.data as unknown as Uint8Array).reduce((n, v) => n + (v !== 0 ? 1 : 0), 0);
    expect(runs).toBeGreaterThan(0);
    expect(runs).toBeLessThan(dark);
    expect(modules).toBeGreaterThan(20);
  });
});
