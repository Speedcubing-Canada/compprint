import { describe, it, expect } from 'vitest';
import { resolveCustomFormat, buildCustomEntries, customEventCardCount } from './customScorecards';
import type { CustomEvent } from '../types/settings';
import { unstackQuadrants, type ScorecardEntry } from './wcif-parser';

function makeEvent(overrides: Partial<CustomEvent> = {}): CustomEvent {
  return {
    name: 'Kilominx',
    iconDataUrl: 'data:image/png;base64,abc',
    format: 'avg5',
    cutoff: '',
    limit: '2:00',
    ...overrides,
  };
}

describe('resolveCustomFormat', () => {
  it('maps every custom format with and without a cutoff', () => {
    expect(resolveCustomFormat('avg5', false)).toBe('avg5');
    expect(resolveCustomFormat('avg5', true)).toBe('bo2-avg5');
    expect(resolveCustomFormat('mo3', false)).toBe('mo3');
    expect(resolveCustomFormat('mo3', true)).toBe('bo1-mo3');
    // bo3 renders with the mo3 layout, mirroring WCIF format '3'
    expect(resolveCustomFormat('bo3', false)).toBe('mo3');
    expect(resolveCustomFormat('bo3', true)).toBe('bo1-mo3');
    // bo2/bo1 take no cutoff - the cutoff flag is ignored
    expect(resolveCustomFormat('bo2', false)).toBe('bo2');
    expect(resolveCustomFormat('bo2', true)).toBe('bo2');
    expect(resolveCustomFormat('bo1', false)).toBe('bo1');
    expect(resolveCustomFormat('bo1', true)).toBe('bo1');
  });
});

describe('buildCustomEntries', () => {
  // null, not '': an empty limit on a WCA blank card means "the delegate writes it in".
  it('marks a blank time limit as no limit', () => {
    expect((buildCustomEntries(makeEvent({ limit: '  ' }))[0] as ScorecardEntry).limit).toBeNull();
  });

  it('returns 4 identical blank cards when no competitors are set', () => {
    const entries = buildCustomEntries(makeEvent()) as ScorecardEntry[];
    expect(entries).toHaveLength(4);
    for (const e of entries) {
      expect(e).toEqual(entries[0]);
      expect(e.kind).toBe('scorecard');
      expect(e.eventId).toBe('custom');
      expect(e.eventName).toBe('Kilominx');
      expect(e.name).toBe('');
      expect(e.wcaId).toBe('');
      expect(e.format).toBe('avg5');
      expect(e.iconDataUrl).toBe('data:image/png;base64,abc');
    }
  });

  it('never sets a WCA Live id (custom competitions are unofficial)', () => {
    const withNames = makeEvent({ competitors: [{ name: 'Alice', wcaId: '2019MART01' }] });
    for (const e of [...buildCustomEntries(makeEvent()), ...buildCustomEntries(withNames)] as ScorecardEntry[]) {
      expect(e.liveId).toBe('');
    }
  });

  it('treats an empty competitors array like no competitors (4 blanks)', () => {
    expect(buildCustomEntries(makeEvent({ competitors: [] }))).toHaveLength(4);
  });

  it('propagates the round label onto every card', () => {
    const entries = buildCustomEntries(makeEvent({ roundLabel: ' Final ' })) as ScorecardEntry[];
    for (const e of entries) expect(e.roundLabel).toBe('Final');
  });

  it('defaults the round label to blank', () => {
    const entries = buildCustomEntries(makeEvent()) as ScorecardEntry[];
    for (const e of entries) expect(e.roundLabel).toBe('');
  });

  it('applies the cutoff-aware format mapping', () => {
    const entries = buildCustomEntries(makeEvent({ format: 'mo3', cutoff: '1:00' })) as ScorecardEntry[];
    for (const e of entries) expect(e.format).toBe('bo1-mo3');
  });

  it('drops a stray cutoff on bo2/bo1 cards (no post-cutoff phase exists)', () => {
    for (const format of ['bo2', 'bo1'] as const) {
      const entries = buildCustomEntries(makeEvent({ format, cutoff: '1:00' })) as ScorecardEntry[];
      for (const e of entries) {
        expect(e.cutoff).toBe('');
        expect(e.format).toBe(format);
      }
    }
  });

  it('emits one named card per competitor, padded with blanks to a multiple of 4', () => {
    const competitors = [
      { name: 'Alice Martin', wcaId: '2019MART01' },
      { name: 'Bob Tremblay', wcaId: '' },
      { name: 'Chloé Roy', wcaId: '2021ROYC01' },
      { name: 'Dan Lee', wcaId: '' },
      { name: 'Eve Chan', wcaId: '' },
    ];
    const entries = unstackQuadrants(buildCustomEntries(makeEvent({ competitors }))) as ScorecardEntry[];
    expect(entries).toHaveLength(8); // 5 named + 3 blank pads
    expect(entries.slice(0, 5).map(e => e.name)).toEqual(competitors.map(c => c.name));
    expect(entries[0].wcaId).toBe('2019MART01');
    expect(entries[1].wcaId).toBe('');
    for (const pad of entries.slice(5)) {
      expect(pad.name).toBe('');
      expect(pad.wcaId).toBe('');
    }
  });

  // Composed accents (the PDF fonts have no combining marks), but parentheses kept: the
  // organizer typed them.
  it('prints CSV names composed and otherwise as typed', () => {
    const competitors = [
      { name: 'Team A (U12)', wcaId: '' },
      { name: 'Nguye\u0302\u0303n Va\u0306n', wcaId: '' },
    ];
    const names = (buildCustomEntries(makeEvent({ competitors })) as ScorecardEntry[]).map(e => e.name);
    expect(names.slice(0, 2)).toEqual(['Team A (U12)', 'Nguyễn Văn']);
  });

  // Cutting a stack of 4-up sheets makes four piles, top-left first; laid in order they must
  // read the CSV top to bottom, as ordinary scorecards do.
  it('prints 4-up in cut-and-stack order, and A6 in plain order', () => {
    const competitors = Array.from({ length: 8 }, (_, i) => ({ name: `P${i + 1}`, wcaId: '' }));
    const names = (a6: boolean) => (buildCustomEntries(makeEvent({ competitors }), a6) as ScorecardEntry[]).map(e => e.name);
    // Sheet 1 holds P1, P3, P5, P7; sheet 2 holds P2, P4, P6, P8.
    expect(names(false)).toEqual(['P1', 'P3', 'P5', 'P7', 'P2', 'P4', 'P6', 'P8']);
    expect(names(true)).toEqual(competitors.map(c => c.name));
  });

  it.each([
    [1, 4],
    [4, 4],
    [5, 8],
    [9, 12],
  ])('pads %i competitors to %i cards', (n, total) => {
    const competitors = Array.from({ length: n }, (_, i) => ({ name: `P${i}`, wcaId: '' }));
    expect(buildCustomEntries(makeEvent({ competitors }))).toHaveLength(total);
  });

  it('blank pads share the event, format, icon and round label of the named cards', () => {
    const entries = buildCustomEntries(makeEvent({
      competitors: [{ name: 'Alice', wcaId: '' }],
      roundLabel: 'Final',
      format: 'bo2',
    })) as ScorecardEntry[];
    const [named, ...pads] = entries;
    for (const pad of pads) {
      expect(pad.eventName).toBe(named.eventName);
      expect(pad.format).toBe(named.format);
      expect(pad.iconDataUrl).toBe(named.iconDataUrl);
      expect(pad.roundLabel).toBe(named.roundLabel);
      expect(pad.cutoff).toBe(named.cutoff);
      expect(pad.limit).toBe(named.limit);
    }
  });
});

describe('customEventCardCount', () => {
  const comp = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `P${i}`, wcaId: '' }));

  it('matches buildCustomEntries, 4-up and A6', () => {
    for (const a6 of [false, true])
      for (const n of [0, 1, 4, 5, 9]) {
        const ev = makeEvent({ competitors: comp(n) });
        expect(customEventCardCount(ev, a6)).toBe(buildCustomEntries(ev, a6).length);
      }
  });

  it('pads to a 4-card sheet, a page of 4 blanks with no competitors', () => {
    expect(customEventCardCount(makeEvent())).toBe(4);
    expect(customEventCardCount(makeEvent({ competitors: comp(5) }))).toBe(8);
  });

  it('does not pad on A6, one blank with no competitors', () => {
    expect(customEventCardCount(makeEvent(), true)).toBe(1);
    expect(customEventCardCount(makeEvent({ competitors: comp(5) }), true)).toBe(5);
  });
});
