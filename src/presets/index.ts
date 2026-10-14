import type { CompetitionSettings } from '../types/settings';
import type { DocumentSelection } from '../lib/generationScope';

// A starting point for the options on /scope and /settings, for regions that always use the
// same setup. Adding one is a JSON file drop in this folder; see README.md.
// A preset moves defaults only: every option stays editable.
export interface Preset {
  id: string;
  // Place names, so not i18n keys: they don't translate, and a contributor dropping a JSON
  // file cannot add keys to the four locale bundles.
  name: string;
  region?: string;
  documents: Partial<DocumentSelection>;
  settings: PresetSettings;
}

// Excludes anything competition-specific: ids, custom events, generationScope.
export type PresetSettings = Partial<Pick<CompetitionSettings,
  | 'language' | 'secondaryLanguage' | 'paperFormat' | 'secondRoundMode'
  | 'useDefaultLogo' | 'hideWcaLiveId'
  | 'nametagLogoMode' | 'nametagQrMode' | 'nametagLayout'
  | 'scorecardCheckMode' | 'scrambleDoubleCheckRegionTop'
>> & {
  // A filename in ./logos, for an organization that prints the same logo at every competition.
  logo?: string;
};

const DOCUMENT_KEYS: (keyof DocumentSelection)[] = [
  'scorecards', 'scheduleTracker', 'nametags', 'roundChecklist', 'firstTimerSlips',
  'groupOverview',
];

// Filename -> asset URL, so the image stays out of the JS bundle.
const LOGOS = Object.fromEntries(
  Object.entries(import.meta.glob('./logos/*.{png,jpg,jpeg}', { eager: true, query: '?url', import: 'default' }))
    .map(([path, url]) => [path.slice('./logos/'.length), url as string]),
);

export function presetLogoUrl(name: string | undefined): string | null {
  return name && Object.hasOwn(LOGOS, name) ? LOGOS[name] : null;
}

// Whitelist of seedable settings keys -> allowed values. 'boolean' means any boolean, 'count' a
// positive integer; an array means "one of these"; secondaryLanguage additionally accepts null.
const SETTING_VALUES: Record<keyof PresetSettings, readonly string[] | 'boolean' | 'count'> = {
  language: ['en', 'fr', 'es', 'pt'],
  secondaryLanguage: ['en', 'fr', 'es', 'pt'],
  paperFormat: ['A4', 'LETTER'],
  secondRoundMode: ['prefilled', 'blanks'],
  useDefaultLogo: 'boolean',
  hideWcaLiveId: 'boolean',
  nametagLogoMode: ['hidden', 'with-name', 'logo-only'],
  nametagQrMode: ['back-only', 'both-sides'],
  nametagLayout: ['vertical', 'horizontal'],
  scorecardCheckMode: ['per-group-card', 'per-round-card', 'none'],
  scrambleDoubleCheckRegionTop: 'count',
  logo: Object.keys(LOGOS),
};

const SETTING_KEYS = Object.keys(SETTING_VALUES) as (keyof PresetSettings)[];

/**
 * Whitelists keys and values, so a contributor's typo or a stale blob cannot push an unknown
 * value into CompetitionSettings. Invalid entries are dropped; a preset with no usable id and
 * name is rejected outright.
 */
export function parsePreset(raw: unknown): Preset | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === 'string' ? o.id.trim() : '';
  const name = typeof o.name === 'string' ? o.name.trim() : '';
  if (!id || !name) return null;

  return {
    id,
    name,
    ...(typeof o.region === 'string' && o.region.trim() ? { region: o.region.trim() } : {}),
    documents: parseDocuments(o.documents),
    settings: parsePresetSettings(o.settings),
  };
}

function parseDocuments(raw: unknown): Partial<DocumentSelection> {
  const out: Partial<DocumentSelection> = {};
  if (!raw || typeof raw !== 'object') return out;
  const o = raw as Record<string, unknown>;
  for (const key of DOCUMENT_KEYS) {
    if (typeof o[key] === 'boolean') out[key] = o[key] as boolean;
  }
  return out;
}

/** Exported so SettingsPage can re-validate the blob it reads back from sessionStorage. */
export function parsePresetSettings(raw: unknown): PresetSettings {
  const out: Record<string, unknown> = {};
  if (!raw || typeof raw !== 'object') return out;
  const o = raw as Record<string, unknown>;
  for (const key of SETTING_KEYS) {
    const value = o[key];
    const allowed = SETTING_VALUES[key];
    if (allowed === 'boolean') {
      if (typeof value === 'boolean') out[key] = value;
    } else if (allowed === 'count') {
      if (Number.isInteger(value) && (value as number) > 0) out[key] = value;
    } else if (key === 'secondaryLanguage' && value === null) {
      out[key] = null;
    } else if (typeof value === 'string' && allowed.includes(value)) {
      out[key] = value;
    }
  }
  return out as PresetSettings;
}

// Build-time glob, so a new region is a file drop and nothing here needs editing.
const modules = import.meta.glob('./*.json', { eager: true, import: 'default' });

/** All shipped presets, sorted by name so file order doesn't drive the UI order. */
export const PRESETS: Preset[] = Object.values(modules)
  .map(parsePreset)
  .filter((p): p is Preset => p !== null)
  .sort((a, b) => a.name.localeCompare(b.name));

const PRESET_SETTINGS_KEY = 'preset_settings';
// Apart from the settings half, which merges into the draft and loses its origin. Which
// region was picked is worth knowing on its own (src/lib/analytics.ts).
const PRESET_ID_KEY = 'preset_id';

/** Stash the settings half of a preset for the /settings step. `null` clears it. */
export function writePresetSettings(settings: PresetSettings | null): void {
  if (!settings) sessionStorage.removeItem(PRESET_SETTINGS_KEY);
  else sessionStorage.setItem(PRESET_SETTINGS_KEY, JSON.stringify(settings));
}

/** Read the stashed preset settings. Missing or corrupt ⇒ `{}` (plain defaults). */
export function readPresetSettings(): PresetSettings {
  try {
    const raw = sessionStorage.getItem(PRESET_SETTINGS_KEY);
    return raw ? parsePresetSettings(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

/** Remember which preset the settings came from. `null` clears it. */
export function writePresetId(id: string | null): void {
  if (!id) sessionStorage.removeItem(PRESET_ID_KEY);
  else sessionStorage.setItem(PRESET_ID_KEY, id);
}

/** The preset chosen this session, or `null` if none was (or storage is unavailable). */
export function readPresetId(): string | null {
  try {
    return sessionStorage.getItem(PRESET_ID_KEY);
  } catch {
    return null;
  }
}

export function clearPresetSettings(): void {
  sessionStorage.removeItem(PRESET_SETTINGS_KEY);
  sessionStorage.removeItem(PRESET_ID_KEY);
}
