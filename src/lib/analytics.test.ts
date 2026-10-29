import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  buildGenerateEvent, buildErrorEvent, buildSessionEvent, buildOutput,
  isOptedOut, setOptedOut,
} from './analytics';
import { emptyParsedWcif, type ParsedWCIF, type NametTagEntry } from './wcif-parser';
import type { CompetitionSettings } from '../types/settings';
import type { WCIF } from '../types/wcif';
import type { PdfJob } from './pdfJobs';

// These builders decide what leaves the browser, so the two things asserted here are the
// two that matter: nothing personal can reach the payload, and the competition-size figures
// come from the unfiltered parse (a narrower generation scope must not shrink them).

function settings(over: Partial<CompetitionSettings> = {}): CompetitionSettings {
  return {
    competitionId: 'GrosJouets2026',
    competitionName: 'Gros Jouets 2026',
    language: 'fr',
    secondaryLanguage: 'en',
    paperFormat: 'A4',
    secondRoundMode: 'prefilled',
    logoDataUrl: null,
    useDefaultLogo: true,
    wcaLiveId: null,
    wcaLivePersonIds: null,
    hideWcaLiveId: false,
    nametagLogoMode: 'with-name',
    nametagQrMode: 'back-only',
    nametagLayout: 'vertical',
    customEvents: [],
    scorecardCheckMode: 'per-group-card',
    scrambleDoubleCheck: false,
    scrambleDoubleCheckRounds: 'finals',
    scrambleDoubleCheckOverrides: null,
    scrambleDoubleCheckWorldTop: 50,
    scrambleDoubleCheckRegionTop: null,
    scrambleDoubleCheckRegionScope: 'national',
    generationScope: {
      mode: 'everything',
      documents: {
        scorecards: true, scheduleTracker: true, nametags: true,
        roundChecklist: false, firstTimerSlips: false, groupOverview: false, venueSchedule: false,
      },
    },
    isCustomCompetition: false,
    ...over,
  } as CompetitionSettings;
}

function person(name: string): NametTagEntry {
  return { name } as NametTagEntry;
}

function parsed(): ParsedWCIF {
  return {
    ...emptyParsedWcif(),
    nametags: [person('Alice'), person('Bob'), person('Chi')],
    scheduleDays: [
      { dayLabel: 'Day 1', stages: [
        { stageName: 'bleu', rows: [] }, { stageName: 'rouge', rows: [] },
      ] },
      { dayLabel: 'Day 2', stages: [{ stageName: 'bleu', rows: [] }] },
    ],
    checkingDays: [
      { dayLabel: 'Day 1', rows: [
        { groupCount: 4 }, { groupCount: 3 },
      ] as ParsedWCIF['checkingDays'][number]['rows'] },
      { dayLabel: 'Day 2', rows: [{ groupCount: 2 }] as ParsedWCIF['checkingDays'][number]['rows'] },
    ],
    stations: { count: 24, source: 'groupifier' },
  };
}

function wcif(): WCIF {
  return {
    id: 'GrosJouets2026',
    events: [
      { rounds: [{}, {}] }, { rounds: [{}] }, { rounds: [{}] },
    ] as WCIF['events'],
    schedule: {
      startDate: '2026-05-01',
      numberOfDays: 2,
      venues: [{
        countryIso2: 'CA',
        latitudeMicrodegrees: 45501700,
        longitudeMicrodegrees: -73567300,
      }] as WCIF['schedule']['venues'],
    },
  } as WCIF;
}

const jobs = [{ kind: 'scorecards' }, { kind: 'nametags' }] as PdfJob[];

function generate(over: Partial<CompetitionSettings> = {}) {
  return buildGenerateEvent({
    parsed: parsed(),
    wcif: wcif(),
    settings: settings(over),
    uiLanguage: 'en',
    presetId: 'quebec',
    output: buildOutput(jobs, 42, 210, 14),
  });
}

describe('buildGenerateEvent', () => {
  it('locates the competition from the first venue', () => {
    expect(generate().comp).toEqual({
      id: 'GrosJouets2026', country: 'CA', lat: 45.5017, lng: -73.5673, custom: false,
    });
  });

  it('sizes the competition from the unfiltered parse', () => {
    expect(generate().size).toEqual({
      competitors: 3, events: 3, rounds: 4, groups: 9, stages: 2, days: 2,
      stations: { count: 24, source: 'groupifier' },
    });
  });

  it('reports the finals station toggle and override', () => {
    expect(generate({ finalStationNumbers: false, stationsPerStage: 12 }).settings).toMatchObject({
      finalStationNumbers: false, stationsPerStage: 12,
    });
  });

  it('counts a stage once even when it runs on several days', () => {
    // Two days, three ScheduleStage entries, but only "bleu" and "rouge" exist.
    expect((generate().size as { stages: number }).stages).toBe(2);
  });

  it('reports output counts separately from competition size', () => {
    expect(generate().output).toEqual({ pdfs: 2, pages: 42, scorecards: 210, coverCards: 14 });
  });

  it('reports which logo was used, never the logo itself', () => {
    const payload = JSON.stringify(generate({ logoDataUrl: 'data:image/png;base64,AAAA' }));
    expect(payload).not.toContain('base64');
    expect(JSON.parse(payload).settings.logo).toBe('custom');
    expect((generate().settings as { logo: string }).logo).toBe('default');
    expect((generate({ useDefaultLogo: false }).settings as { logo: string }).logo).toBe('none');
  });

  // The scope is only meaningful while the regional rule is on, so it reports as null when off.
  it('reports the regional ranking scope only when that rule is on', () => {
    type Dc = { scrambleDoubleCheckRegionScope: string | null };
    expect((generate().settings as Dc).scrambleDoubleCheckRegionScope).toBeNull();
    const on = generate({
      scrambleDoubleCheck: true, scrambleDoubleCheckRegionTop: 1, scrambleDoubleCheckRegionScope: 'continental',
    });
    expect((on.settings as Dc).scrambleDoubleCheckRegionScope).toBe('continental');
  });

  // The draft keeps the ranking rules while the feature is off; they must not count as used.
  it('reports no ranking rules while the double-check is off', () => {
    const rules = { scrambleDoubleCheckWorldTop: 50, scrambleDoubleCheckRegionTop: 3 };
    expect(generate({ scrambleDoubleCheck: false, ...rules }).settings).toMatchObject({
      scrambleDoubleCheckWorldTop: null, scrambleDoubleCheckRegionTop: null, scrambleDoubleCheckRegionScope: null,
    });
    expect(generate({ scrambleDoubleCheck: true, ...rules }).settings).toMatchObject({
      scrambleDoubleCheckWorldTop: 50, scrambleDoubleCheckRegionTop: 3, scrambleDoubleCheckRegionScope: 'national',
    });
  });

  it('lists only the selected documents, sorted', () => {
    expect(generate().scope).toEqual({
      mode: 'everything', documents: ['nametags', 'scheduleTracker', 'scorecards'],
    });
  });

  it('counts only named custom events', () => {
    const s = generate({ customEvents: [
      { name: 'Mirror Blocks' }, { name: '  ' },
    ] as CompetitionSettings['customEvents'] });
    expect((s.settings as { customEvents: number }).customEvents).toBe(1);
  });

  // Zeros would drag the dashboard's size averages down.
  it('has no location or size for a custom competition, which has no WCIF', () => {
    const e = buildGenerateEvent({
      parsed: emptyParsedWcif(),
      wcif: null,
      settings: settings({ isCustomCompetition: true, competitionId: 'my-comp' }),
      uiLanguage: 'en',
      presetId: null,
      output: buildOutput([], 4, 8, 0),
    });
    expect(e.comp).toEqual({ id: 'my-comp', country: null, lat: null, lng: null, custom: true });
    expect(e.size).toBeNull();
  });

  it('carries nothing that identifies a person', () => {
    const payload = JSON.stringify(generate());
    for (const secret of ['Alice', 'Bob', 'Chi', 'Gros Jouets'])
      expect(payload).not.toContain(secret);
  });
});

describe('buildErrorEvent', () => {
  it('records where it broke without the competition name', () => {
    const e = buildErrorEvent('GrosJouets2026', 'fetch', new Error('WCIF fetch failed (403)'));
    expect(e).toEqual({
      v: 1, event: 'error', comp: { id: 'GrosJouets2026' },
      stage: 'fetch', message: 'Error: WCIF fetch failed (403)',
    });
  });

  it('truncates a runaway message', () => {
    const e = buildErrorEvent('X', 'render', 'y'.repeat(1000));
    expect((e.message as string).length).toBe(200);
  });
});

describe('buildSessionEvent', () => {
  it('carries nothing but the fact that a session started', () => {
    expect(buildSessionEvent()).toEqual({ v: 1, event: 'session' });
  });
});

// vitest runs in the `node` environment here, so provide the storage the module expects.
const store = new Map<string, string>();
// Re-stubbed per test, so the throwing-storage case can't leak into the others.
beforeEach(() => {
  store.clear();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
});

// `send` can't be tested for this: it already returns early because import.meta.env.PROD is
// false under vitest, so such a test would pass whether or not the opt-out works.
describe('opt-out', () => {
  it('defaults to opted in', () => {
    expect(isOptedOut()).toBe(false);
  });

  it('round-trips both ways', () => {
    setOptedOut(true);
    expect(isOptedOut()).toBe(true);
    setOptedOut(false);
    expect(isOptedOut()).toBe(false);
  });

  it('degrades to opted in when storage throws (private mode)', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
    });
    expect(() => setOptedOut(true)).not.toThrow();
    expect(isOptedOut()).toBe(false);
  });
});
