import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  DEFAULT_SCOPE,
  clearCustom, clearDownstream, clearSettings, readCompetition, readCustomEvents, readDetection,
  readHasGroups, readIsCustom, readFileName, readScope, readSettings, readStoredScope,
  readStoredSettings, writeCompetition, writeCustom, writeFileName, writeHasGroups, writeScope,
  writeSettings,
} from './flowState';
import type { CompetitionSettings } from '../types/settings';
import { testSettings } from '../test/fixtures';

// The storage layer of the wizard handoff (the pages themselves are driven by
// pages/wizard.route.test.tsx). Two things break it: a value not surviving the round
// trip, and a missing or corrupt blob throwing on a page that is mid-render.

// vitest runs in the `node` environment here, so provide the storage the module expects.
const store = new Map<string, string>();
vi.stubGlobal('sessionStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
});

beforeEach(() => store.clear());

describe('competition identity', () => {
  it('round-trips id and name', () => {
    writeCompetition('WC2026', 'World Championship 2026');
    expect(readCompetition()).toEqual({ id: 'WC2026', name: 'World Championship 2026' });
  });

  it('reads empty strings when unset, so the page can redirect rather than crash', () => {
    expect(readCompetition()).toEqual({ id: '', name: '' });
  });

  it('keeps non-ASCII names intact', () => {
    writeCompetition('GrosJouetsaMontreal2026', 'Gros Jouets à Montréal 2026');
    expect(readCompetition().name).toBe('Gros Jouets à Montréal 2026');
  });
});

describe('group detection', () => {
  it('round-trips both values', () => {
    writeHasGroups(false);
    expect(readHasGroups()).toBe(false);
    writeHasGroups(true);
    expect(readHasGroups()).toBe(true);
  });

  // Unset means the scope step was skipped, not that there are no groups.
  it('treats unset as "has groups"', () => {
    expect(readHasGroups()).toBe(true);
  });
});

describe('generation scope', () => {
  const scope = {
    mode: 'selected' as const,
    rounds: [{ eventId: '333', roundNum: 2 }],
    documents: {
      scorecards: true, scheduleTracker: false, nametags: false,
      roundChecklist: true, firstTimerSlips: false, groupOverview: false,
    },
  };

  it('round-trips scope and detection together', () => {
    writeScope(scope, { showSecondRoundMode: false, multiStage: false });
    expect(readScope()).toEqual(scope);
    expect(readDetection()).toEqual({ showSecondRoundMode: false, multiStage: false, detectedStations: null });
  });

  it('falls back to the everything-scope when unset', () => {
    expect(readScope()).toEqual(DEFAULT_SCOPE);
  });

  it('falls back to the everything-scope when the blob is corrupt', () => {
    sessionStorage.setItem('generation_scope', '{not json');
    expect(readScope()).toEqual(DEFAULT_SCOPE);
  });

  // The scope step has to tell "nothing stored yet" from a real scope, which readScope cannot.
  it('readStoredScope reads null when unset and the scope when set', () => {
    expect(readStoredScope()).toBeNull();
    writeScope(scope, { showSecondRoundMode: false, multiStage: false });
    expect(readStoredScope()).toEqual(scope);
  });

  it('readStoredScope reads null for a corrupt blob or one written before document selection', () => {
    sessionStorage.setItem('generation_scope', '{not json');
    expect(readStoredScope()).toBeNull();
    sessionStorage.setItem('generation_scope', JSON.stringify({ mode: 'everything' }));
    expect(readStoredScope()).toBeNull();
  });

  // Opposite default to showSecondRoundMode: without the scope parse the stage count is
  // unknown, and offering a per-stage split we cannot honour is worse than not offering it.
  it('reports multiStage only when the scope step actually detected it', () => {
    writeScope(DEFAULT_SCOPE, { showSecondRoundMode: false, multiStage: true });
    expect(readDetection().multiStage).toBe(true);
    writeScope(DEFAULT_SCOPE, { showSecondRoundMode: false, multiStage: false });
    expect(readDetection().multiStage).toBe(false);
    sessionStorage.setItem('generation_detection', JSON.stringify({ showSecondRoundMode: true }));
    expect(readDetection().multiStage).toBe(false);
  });

  it('round-trips the detected station count, null when absent', () => {
    writeScope(DEFAULT_SCOPE, { showSecondRoundMode: false, multiStage: false, detectedStations: 24 });
    expect(readDetection().detectedStations).toBe(24);
    sessionStorage.setItem('generation_detection', JSON.stringify({ showSecondRoundMode: true }));
    expect(readDetection().detectedStations).toBeNull();
  });

  // Absent detection means the scope step was bypassed, so the Round 2 mode shows.
  it('shows the second-round mode when detection is absent or corrupt', () => {
    expect(readDetection()).toEqual({ showSecondRoundMode: true, multiStage: false, detectedStations: null });
    sessionStorage.setItem('generation_detection', 'null');
    expect(readDetection()).toEqual({ showSecondRoundMode: true, multiStage: false, detectedStations: null });
    sessionStorage.setItem('generation_detection', '{');
    expect(readDetection()).toEqual({ showSecondRoundMode: true, multiStage: false, detectedStations: null });
  });
});

describe('custom competitions', () => {
  const events = [
    { name: 'Clock Relay', iconDataUrl: null, format: 'avg5' as const, cutoff: '', limit: '' },
  ];

  it('round-trips the flag and the events', () => {
    writeCustom(events);
    expect(readIsCustom()).toBe(true);
    expect(readCustomEvents()).toEqual(events);
  });

  it('reads false / empty when unset', () => {
    expect(readIsCustom()).toBe(false);
    expect(readCustomEvents()).toEqual([]);
  });

  it('reads an empty list when the blob is corrupt', () => {
    sessionStorage.setItem('custom_competition_events', 'undefined');
    expect(readCustomEvents()).toEqual([]);
  });

  // Leaked into a WCA flow it would suppress the WCA Live fields and print unofficial cards.
  it('clearCustom drops both keys', () => {
    writeCustom(events);
    clearCustom();
    expect(readIsCustom()).toBe(false);
    expect(readCustomEvents()).toEqual([]);
  });

  it('keeps the events, icons included, out of the settings blob', () => {
    const withIcon = [{ ...events[0], iconDataUrl: 'data:image/png;base64,AAAA' }];
    writeCustom(withIcon);
    writeSettings(testSettings({ isCustomCompetition: true, customEvents: withIcon }));
    expect(sessionStorage.getItem('competition_settings')).not.toContain('data:image');
    expect(readSettings()?.customEvents).toEqual(withIcon);
  });

  it('writeSettings stores the events itself', () => {
    writeSettings(testSettings({ isCustomCompetition: true, customEvents: events }));
    expect(readCustomEvents()).toEqual(events);
  });

  it('keeps the old events when the settings blob does not fit', () => {
    writeCustom(events);
    const set = sessionStorage.setItem;
    vi.spyOn(sessionStorage, 'setItem').mockImplementation((k, v) => {
      if (k === 'competition_settings') throw new DOMException('full', 'QuotaExceededError');
      set(k, v);
    });
    const renamed = [{ ...events[0], name: 'Pyra Relay' }];
    expect(() => writeSettings(testSettings({ isCustomCompetition: true, customEvents: renamed }))).toThrow();
    vi.restoreAllMocks();
    expect(readCustomEvents()).toEqual(events);
  });
});

describe('settings blob', () => {
  const settings = {
    competitionId: 'WC2026',
    competitionName: 'World Championship 2026',
    language: 'fr',
    secondaryLanguage: 'en',
    paperFormat: 'A4',
    secondRoundMode: 'blanks',
    logoDataUrl: null,
    useDefaultLogo: true,
    wcaLiveId: '9667',
    wcaLivePersonIds: { 1: '42' },
    hideWcaLiveId: false,
    nametagLogoMode: 'with-name',
    nametagQrMode: 'back-only',
    nametagLayout: 'vertical',
    customEvents: [],
    scorecardCheckMode: 'per-group-card',
    scrambleDoubleCheck: false,
    scrambleDoubleCheckRounds: ['finals'],
    scrambleDoubleCheckOverrides: {},
    generationScope: DEFAULT_SCOPE,
    isCustomCompetition: false,
  } as unknown as CompetitionSettings;

  it('round-trips every field', () => {
    writeSettings(settings);
    expect(readStoredSettings()).toEqual(settings);
  });

  it('reads null when absent, so the generate page redirects instead of guessing', () => {
    expect(readStoredSettings()).toBeNull();
  });

  // A blob half-written by an interrupted session must not throw on a rendering page.
  it('reads null when the blob is corrupt', () => {
    sessionStorage.setItem('competition_settings', '{"language":');
    expect(readStoredSettings()).toBeNull();
  });
});

describe('settings restore', () => {
  const stored = (extra: Record<string, unknown>) =>
    sessionStorage.setItem('competition_settings', JSON.stringify({ language: 'en', ...extra }));

  it('reads null when absent or corrupt', () => {
    expect(readSettings()).toBeNull();
    sessionStorage.setItem('competition_settings', '{"language":');
    expect(readSettings()).toBeNull();
  });

  // A session can hold a blob written by an older build, and the settings step seeds its
  // whole form from it.
  it('migrates the retired bilingual languages onto primary + secondary', () => {
    stored({ language: 'bilingual-fr' });
    expect(readSettings()).toMatchObject({ language: 'fr', secondaryLanguage: 'en' });
    stored({ language: 'bilingual-en' });
    expect(readSettings()).toMatchObject({ language: 'en', secondaryLanguage: 'fr' });
  });

  it('backfills the fields added since a blob may have been written', () => {
    stored({});
    expect(readSettings()).toMatchObject({
      secondaryLanguage: null,
      generationScope: { mode: 'everything', documents: DEFAULT_SCOPE.documents },
      hideWcaLiveId: false,
      splitPdfsByStage: false,
      finalStationNumbers: true,
      stationsPerStage: null,
      liveResultsMode: 'wca-live',
      isCustomCompetition: false,
      scorecardCheckMode: 'per-group-card',
      // The live defaults, so an old blob and a fresh one cannot mean two different things.
      scrambleDoubleCheckWorldTop: 50,
      scrambleDoubleCheckRegionTop: null,
      scrambleDoubleCheckRegionScope: 'national',
    });
  });

  it('backfills roundChecklist into an earlier four-key document selection', () => {
    stored({ generationScope: { mode: 'latest', documents: {
      scorecards: true, scheduleTracker: false, nametags: false, firstTimerSlips: false, groupOverview: false,
    } } });
    expect(readSettings()?.generationScope.documents.roundChecklist).toBe(false);
  });

  // The checking sheet is its own document, so only the cover-card half survives.
  it('maps the retired checking-sheet mode onto none', () => {
    stored({ scorecardCheckMode: 'checking-sheet' });
    expect(readSettings()?.scorecardCheckMode).toBe('none');
  });
});

describe('uploaded file names', () => {
  it('round-trips each kind independently, and null clears', () => {
    writeFileName('logo', 'club-logo.png');
    writeFileName('dcOverrides', 'double-checks.csv');
    expect(readFileName('logo')).toBe('club-logo.png');
    expect(readFileName('dcOverrides')).toBe('double-checks.csv');
    writeFileName('logo', null);
    expect(readFileName('logo')).toBeNull();
    expect(readFileName('dcOverrides')).toBe('double-checks.csv');
  });

  it('reads null when unset', () => {
    expect(readFileName('logo')).toBeNull();
    expect(readFileName('dcOverrides')).toBeNull();
  });
});

describe('clearing', () => {
  function fillFlow() {
    writeCompetition('WC2026', 'World Championship 2026');
    writeHasGroups(false);
    writeScope(DEFAULT_SCOPE, { showSecondRoundMode: false, multiStage: false });
    writeSettings({ competitionId: 'WC2026' } as CompetitionSettings);
    writeFileName('logo', 'club-logo.png');
    writeFileName('dcOverrides', 'double-checks.csv');
  }

  // A different competition must not inherit the previous one's scope and settings.
  it('clearDownstream drops everything after the picker, keeping the competition', () => {
    fillFlow();
    clearDownstream();
    expect(readStoredScope()).toBeNull();
    expect(readDetection()).toEqual({ showSecondRoundMode: true, multiStage: false, detectedStations: null });
    expect(readHasGroups()).toBe(true);
    expect(readSettings()).toBeNull();
    expect(readFileName('logo')).toBeNull();
    expect(readFileName('dcOverrides')).toBeNull();
    expect(readCompetition()).toEqual({ id: 'WC2026', name: 'World Championship 2026' });
  });

  // A new preset's seeds must not lose to what was submitted under the old one.
  it('clearSettings drops only the settings and the upload names', () => {
    fillFlow();
    clearSettings();
    expect(readSettings()).toBeNull();
    expect(readFileName('logo')).toBeNull();
    expect(readFileName('dcOverrides')).toBeNull();
    expect(readStoredScope()).toEqual(DEFAULT_SCOPE);
    expect(readHasGroups()).toBe(false);
  });
});
