import { describe, it, expect, beforeEach } from 'vitest';
import {
  PRESETS, parsePreset, parsePresetSettings, presetLogoUrl,
  writePresetSettings, readPresetSettings, clearPresetSettings,
} from './index';

// The raw files, unvalidated - so we can prove nothing got silently dropped.
const rawFiles = import.meta.glob('./*.json', { eager: true, import: 'default' }) as Record<
  string,
  Record<string, unknown>
>;

describe('parsePreset', () => {
  const valid = { id: 'x', name: 'X', documents: { roundChecklist: true }, settings: { nametagLayout: 'horizontal' } };

  it('accepts a well-formed preset', () => {
    expect(parsePreset(valid)).toEqual({
      id: 'x', name: 'X',
      documents: { roundChecklist: true },
      settings: { nametagLayout: 'horizontal' },
    });
  });

  it('keeps region only when it is a non-empty string', () => {
    expect(parsePreset({ ...valid, region: 'Canada' })?.region).toBe('Canada');
    expect(parsePreset({ ...valid, region: '  ' })).not.toHaveProperty('region');
    expect(parsePreset({ ...valid, region: 42 })).not.toHaveProperty('region');
  });

  it('rejects a preset with no id or no name', () => {
    expect(parsePreset({ ...valid, id: '' })).toBeNull();
    expect(parsePreset({ ...valid, name: '   ' })).toBeNull();
    expect(parsePreset({ name: 'X' })).toBeNull();
  });

  it('rejects non-objects', () => {
    for (const bad of [null, undefined, 'ontario', 7, [valid]]) {
      expect(parsePreset(bad)).toBeNull();
    }
  });

  it('drops unknown document keys and non-booleans', () => {
    const p = parsePreset({ ...valid, documents: { nametags: false, scorcards: true, roundChecklist: 'yes' } });
    expect(p?.documents).toEqual({ nametags: false });
  });

  it('tolerates missing/garbage documents and settings blocks', () => {
    const p = parsePreset({ id: 'x', name: 'X' });
    expect(p?.documents).toEqual({});
    expect(p?.settings).toEqual({});
    expect(parsePreset({ id: 'x', name: 'X', documents: 'all', settings: 3 })?.settings).toEqual({});
  });
});

describe('parsePresetSettings', () => {
  it('drops unknown keys and out-of-range values', () => {
    expect(parsePresetSettings({
      nametagLayout: 'diagonal',      // not a NametTagLayout
      language: 'de',                 // not a LocaleCode
      paperFormat: 'LETTER',          // ok
      hideWcaLiveId: 'true',          // string, not boolean
      competitionId: 'HackedComp',    // not seedable at all
      logoDataUrl: 'data:image/png',  // not seedable at all
    })).toEqual({ paperFormat: 'LETTER' });
  });

  it('allows null secondaryLanguage but not null elsewhere', () => {
    expect(parsePresetSettings({ secondaryLanguage: null })).toEqual({ secondaryLanguage: null });
    expect(parsePresetSettings({ language: null })).toEqual({});
  });

  it('accepts every seedable field', () => {
    const all = {
      language: 'fr', secondaryLanguage: 'en', paperFormat: 'A4', secondRoundMode: 'blanks',
      useDefaultLogo: false, hideWcaLiveId: true, nametagLogoMode: 'hidden',
      nametagQrMode: 'both-sides', nametagLayout: 'horizontal',
      scorecardCheckMode: 'none', scrambleDoubleCheckRegionTop: 15, logo: 'abracm.png',
    };
    expect(parsePresetSettings(all)).toEqual(all);
  });

  it('takes only a positive integer region top', () => {
    for (const bad of [0, -3, 1.5, '15', null]) {
      expect(parsePresetSettings({ scrambleDoubleCheckRegionTop: bad })).toEqual({});
    }
  });

  it('takes only a logo shipped in ./logos', () => {
    expect(parsePresetSettings({ logo: 'missing.png' })).toEqual({});
    expect(parsePresetSettings({ logo: '../ontario.json' })).toEqual({});
    expect(presetLogoUrl('missing.png')).toBeNull();
    expect(presetLogoUrl(undefined)).toBeNull();
    expect(parsePresetSettings({ logo: 'constructor' })).toEqual({});
    expect(presetLogoUrl('constructor')).toBeNull();
    expect(presetLogoUrl('__proto__')).toBeNull();
  });

  it('returns {} for junk', () => {
    for (const bad of [null, undefined, 'x', 1, []]) expect(parsePresetSettings(bad)).toEqual({});
  });
});

// The cross-page contract: /scope writes, /settings reads. vitest runs in node, so
// stub the storage the two pages share.
describe('preset settings handoff', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    (globalThis as { sessionStorage?: unknown }).sessionStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
  });

  it('round-trips a preset\'s settings', () => {
    const ontario = PRESETS.find(p => p.id === 'ontario')!;
    writePresetSettings(ontario.settings);
    expect(readPresetSettings()).toEqual(ontario.settings);
  });

  it('reads {} when nothing was written', () => {
    expect(readPresetSettings()).toEqual({});
  });

  it('clears on write(null), so switching to Default drops the previous preset', () => {
    writePresetSettings({ nametagLayout: 'horizontal' });
    writePresetSettings(null);
    expect(readPresetSettings()).toEqual({});
  });

  it('clears on clearPresetSettings(), so a preset cannot leak to the next competition', () => {
    writePresetSettings({ hideWcaLiveId: true });
    clearPresetSettings();
    expect(readPresetSettings()).toEqual({});
  });

  it('re-validates on read, so a hand-edited blob cannot inject settings', () => {
    sessionStorage.setItem('preset_settings', JSON.stringify({
      nametagLayout: 'horizontal', competitionId: 'evil', paperFormat: 'A3',
    }));
    expect(readPresetSettings()).toEqual({ nametagLayout: 'horizontal' });
  });

  it('falls back to {} on unparseable JSON', () => {
    sessionStorage.setItem('preset_settings', '{not json');
    expect(readPresetSettings()).toEqual({});
  });
});

describe('shipped presets', () => {
  it('ships at least one', () => {
    expect(PRESETS.length).toBeGreaterThan(0);
    expect(PRESETS.length).toBe(Object.keys(rawFiles).length);
  });

  it('has unique ids', () => {
    expect(new Set(PRESETS.map(p => p.id)).size).toBe(PRESETS.length);
  });

  it('is sorted by name', () => {
    const names = PRESETS.map(p => p.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  // Guards the silent-typo failure mode: a misspelled key parses fine but does nothing.
  it('loses no field to validation', () => {
    for (const [file, raw] of Object.entries(rawFiles)) {
      const parsed = parsePreset(raw);
      expect(parsed, `${file} failed to parse`).not.toBeNull();
      expect(Object.keys(parsed!.documents).sort(), `${file}: dropped document keys`)
        .toEqual(Object.keys((raw.documents ?? {}) as object).sort());
      expect(Object.keys(parsed!.settings).sort(), `${file}: dropped settings keys`)
        .toEqual(Object.keys((raw.settings ?? {}) as object).sort());
    }
  });

  it('matches the regional presets described in the feedback', () => {
    const byId = Object.fromEntries(PRESETS.map(p => [p.id, p]));
    expect(byId.ontario.documents.firstTimerSlips).toBe(true);
    expect(byId.ontario.settings).toMatchObject({
      hideWcaLiveId: true, nametagLogoMode: 'hidden', nametagLayout: 'horizontal',
    });
    expect(byId.quebec.settings).toMatchObject({ language: 'fr', secondaryLanguage: 'en' });
    expect(byId['british-columbia'].documents).toEqual({
      scheduleTracker: false, nametags: false, roundChecklist: true, groupOverview: true,
    });
    expect(byId.brasilia.documents).toEqual({
      scheduleTracker: false, nametags: false, firstTimerSlips: true,
    });
    expect(byId.brasilia.settings).toEqual({
      language: 'pt', paperFormat: 'A4', scrambleDoubleCheckRegionTop: 15, logo: 'abracm.png',
    });
    expect(presetLogoUrl(byId.brasilia.settings.logo)).toBeTruthy();
  });
});
