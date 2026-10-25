// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import type { CompetitionSettings, CustomEvent } from '../types/settings';
import { markAllSeen } from '../changelog';
import { renderWithProviders, useEnglish } from '../test/render';
import { testSettings } from '../test/fixtures';
import {
  DEFAULT_SCOPE, readSettings, writeCompetition, writeCustom, writeFileName, writeScope,
  writeSettings,
} from '../lib/flowState';
import { writePresetSettings } from '../presets';
import SettingsPage from './SettingsPage';

// The one page whose whole form is seeded from storage, so back-navigation from /generate
// keeps the organizer's choices. A stray key after the restore spread once wiped the custom
// events, which sit behind a collapsed section where nobody notices until they print.

vi.mock('../auth/wca', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../auth/wca')>()),
  // No network from a test, and no auto-filled id to compete with a restored one.
  fetchCompetitionInfo: vi.fn().mockResolvedValue({ scoretakingSoftware: 'wca_live', onTheSpot: false }),
  fetchWcaLiveId: vi.fn().mockResolvedValue(null),
  fetchWcaLivePersonIds: vi.fn().mockResolvedValue(null),
}));

import { fetchCompetitionInfo, fetchWcaLiveId } from '../auth/wca';
const mockInfo = vi.mocked(fetchCompetitionInfo);
const mockScoretaking = {
  mockResolvedValue: (sw: 'wca_live' | 'internal', onTheSpot = false) =>
    mockInfo.mockResolvedValue({ scoretakingSoftware: sw, onTheSpot }),
};
const mockWcaLiveId = vi.mocked(fetchWcaLiveId);

const event = (name: string): CustomEvent =>
  ({ name, iconDataUrl: null, format: 'avg5', cutoff: '', limit: '' });

const stored = (overrides: Partial<CompetitionSettings> = {}): CompetitionSettings =>
  testSettings({
    competitionId: 'WC2026',
    competitionName: 'World Championship 2026',
    useDefaultLogo: false,
    generationScope: DEFAULT_SCOPE,
    scrambleDoubleCheck: true,
    scrambleDoubleCheckWorldTop: 50,
    ...overrides,
  });

async function renderSettings() {
  const view = renderWithProviders(<SettingsPage />);
  // Settles the WCA Live lookup the page fires on mount.
  await screen.findByRole('button', { name: /Generate/ });
  return view;
}

const generate = () => fireEvent.click(screen.getByRole('button', { name: /Generate/ }));
const advancedToggle = () => screen.getByRole('button', { name: 'Advanced' });

beforeEach(async () => {
  sessionStorage.clear();
  localStorage.clear();
  // No What's New dialog over the page, and one language so accessible names are stable.
  markAllSeen();
  await useEnglish();
  vi.clearAllMocks();
  mockScoretaking.mockResolvedValue('wca_live');
  mockWcaLiveId.mockResolvedValue(null);
  writeCompetition('WC2026', 'World Championship 2026');
  writeScope(DEFAULT_SCOPE, { showSecondRoundMode: false, multiStage: false });
});

afterEach(cleanup);

// The only settings whose checkbox and number must stay in step: the threshold IS the switch,
// so an empty box must never be saved.
describe('scramble double-check ranking rules', () => {
  // Checkbox and threshold share the rule's name; the role tells them apart.
  const box = (name: string) => screen.getByRole('checkbox', { name });
  const top = (name: string) => screen.getByRole('textbox', { name }) as HTMLInputElement;
  const worldTop = () => top('World rankings, top');
  const regionTop = () => top('Regional rankings, top');

  // The rules live under Advanced, collapsed by default.
  async function openDoubleCheck() {
    await renderSettings();
    fireEvent.click(advancedToggle());
  }

  it('starts on the world top 50 with the regional rule off', async () => {
    await openDoubleCheck();
    expect(worldTop().value).toBe('50');
    expect(regionTop().value).toBe('');
    expect(regionTop().disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Continental' })).toBeNull();
  });

  it('ticking the regional rule reveals its scope and saves the pair', async () => {
    await openDoubleCheck();
    fireEvent.click(box('Regional rankings, top'));
    fireEvent.click(screen.getByRole('button', { name: 'Continental' }));
    generate();

    expect(readSettings()).toMatchObject({
      scrambleDoubleCheckRegionTop: 1,
      scrambleDoubleCheckRegionScope: 'continental',
    });
  });

  it('unticking a rule stores null, not a number', async () => {
    await openDoubleCheck();
    fireEvent.click(box('World rankings, top'));
    generate();

    expect(readSettings()?.scrambleDoubleCheckWorldTop).toBeNull();
  });

  it('an emptied threshold snaps back to its default instead of saving blank', async () => {
    await openDoubleCheck();
    fireEvent.change(worldTop(), { target: { value: '' } });
    expect(worldTop().value).toBe('0');
    fireEvent.blur(worldTop());
    generate();

    expect(readSettings()?.scrambleDoubleCheckWorldTop).toBe(50);
  });

  // A whole round is only worth double-checking at a championship, and neither the WCIF nor
  // the API says whether one is: the name is the only signal. Seeded from a preset, since a
  // stored blob would beat the default.
  it('leaves the round rule off, and ticks Finals only for a championship', async () => {
    const finalsChecked = () =>
      (screen.getByRole('checkbox', { name: 'Finals' }) as HTMLInputElement).checked;

    writeCompetition('TorontoOpen2026', 'Toronto Open 2026');
    await openDoubleCheck();
    expect(finalsChecked()).toBe(false);

    cleanup();
    writeCompetition('CanChamp2026', 'Canadian Championship 2026');
    await openDoubleCheck();
    expect(finalsChecked()).toBe(true);
  });

  // Regulation 11i applies everywhere, so there is no opt-in: just rules that can be unticked.
  it('has no enable switch and is collapsed until Advanced is opened', async () => {
    await renderSettings();
    expect(screen.queryByRole('checkbox', { name: /Enable scramble/i })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: 'World rankings, top' })).toBeNull();
    generate();

    expect(readSettings()).toMatchObject({
      scrambleDoubleCheck: true,
      scrambleDoubleCheckWorldTop: 50,
      scrambleDoubleCheckRegionTop: null,
    });
  });

  // An older blob carries `false`, with nothing left to undo it.
  it('re-enables a restored submission that had it switched off', async () => {
    writeSettings(stored({ scrambleDoubleCheck: false }));
    await renderSettings();
    generate();

    expect(readSettings()?.scrambleDoubleCheck).toBe(true);
  });

  // Scorecards-only must not hide the rules; only the custom-event editor below them.
  it('stays reachable when only some documents are generated', async () => {
    writeScope({
      mode: 'latest',
      documents: { scorecards: true, scheduleTracker: false, nametags: false, roundChecklist: false, firstTimerSlips: false, groupOverview: false },
    }, { showSecondRoundMode: false, multiStage: false });
    await openDoubleCheck();

    expect(box('World rankings, top')).toBeTruthy();
    expect(screen.queryByPlaceholderText(/Event name/)).toBeNull();
  });

  it('keeps digits only', async () => {
    await openDoubleCheck();
    fireEvent.change(worldTop(), { target: { value: '1e2!' } });
    generate();

    expect(readSettings()?.scrambleDoubleCheckWorldTop).toBe(12);
  });
});

describe('restoring the previous submission', () => {
  // Reported bug: a custom event on a WCA competition lives only in the settings blob, and
  // came back empty after Back on the download page.
  it('restores a custom event and opens the section holding it', async () => {
    writeSettings(stored({ customEvents: [event('Mini Guildford')] }));
    await renderSettings();

    expect(screen.getByDisplayValue('Mini Guildford')).toBeTruthy();
    expect(advancedToggle().getAttribute('aria-expanded')).toBe('true');
  });

  it('leaves the advanced section closed when nothing was restored into it', async () => {
    writeSettings(stored());
    await renderSettings();

    expect(advancedToggle().getAttribute('aria-expanded')).toBe('false');
  });

  it('restores an option over the preset that seeded it', async () => {
    writePresetSettings({ paperFormat: 'A4' });
    writeSettings(stored({ paperFormat: 'LETTER' }));
    const { container } = await renderSettings();

    expect(container.querySelector<HTMLInputElement>('input[name="paper"][value="LETTER"]')?.checked).toBe(true);
  });

  it('falls back to the preset, then to the plain default, with nothing submitted yet', async () => {
    writePresetSettings({ paperFormat: 'A4' });
    const { container } = await renderSettings();
    expect(container.querySelector<HTMLInputElement>('input[name="paper"][value="A4"]')?.checked).toBe(true);

    cleanup();
    writePresetSettings(null);
    const plain = await renderSettings();
    expect(plain.container.querySelector<HTMLInputElement>('input[name="paper"][value="LETTER"]')?.checked).toBe(true);
  });

  it('names the restored uploads, which are not part of the settings blob', async () => {
    writeSettings(stored({
      logoDataUrl: 'data:image/png;base64,iVBORw0KGgo=',
      scrambleDoubleCheck: true,
      scrambleDoubleCheckOverrides: { '333|1': ['2019SMIT01'] },
    }));
    writeFileName('logo', 'club-logo.png');
    writeFileName('dcOverrides', 'double-checks.csv');
    await renderSettings();

    expect(screen.getByText('club-logo.png')).toBeTruthy();
    expect(advancedToggle().getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('double-checks.csv')).toBeTruthy();
  });

  it('offers the scorecard comp name option only once a custom logo is uploaded', async () => {
    const label = 'Show the competition name on scorecards';
    await renderSettings();
    expect(screen.queryByText(label)).toBeNull();

    cleanup();
    writeSettings(stored({ logoDataUrl: 'data:image/png;base64,iVBORw0KGgo=' }));
    await renderSettings();
    fireEvent.click(screen.getByText(label));
    generate();
    expect(readSettings()?.scorecardCompNameWithLogo).toBe(true);
  });

  // Restore and submit untouched: a field dropped from the draft shows up here as a loss.
  it('re-submits everything it restored', async () => {
    const settings = stored({
      language: 'fr', secondaryLanguage: 'en', paperFormat: 'A4', secondRoundMode: 'blanks',
      nametagLayout: 'horizontal', nametagQrMode: 'both-sides', scorecardCheckMode: 'none',
      hideWcaLiveId: true, wcaLiveId: '9667', useDefaultLogo: true, liveResultsMode: 'ilr',
      scorecardCompNameWithLogo: true,
      scrambleDoubleCheck: true, scrambleDoubleCheckRounds: ['firstRound'],
      scrambleDoubleCheckOverrides: { '333|1': ['2019SMIT01'] },
      customEvents: [event('Mini Guildford')],
    });
    writeSettings(settings);
    await renderSettings();
    generate();

    expect(readSettings()).toEqual(settings);
  });
});

describe('custom competitions', () => {
  // /custom writes its own key, and an older blob must not win over it.
  it('takes its events from the custom-competition key, not the older blob', async () => {
    writeCompetition('custom-my-comp', 'My Comp');
    writeSettings(stored({
      competitionId: 'custom-my-comp', competitionName: 'My Comp',
      isCustomCompetition: true, customEvents: [event('Clock Relay')],
    }));
    writeCustom([event('Mini Guildford')]);
    await renderSettings();
    generate();

    expect(readSettings()?.customEvents.map(e => e.name)).toEqual(['Mini Guildford']);
  });
});

// `scoretaking_software` decides where the name tag QR codes point. ILR needs nothing from
// the WCA Live API, so it must not be called.
describe('live results mode', () => {
  it('preselects ILR and skips the WCA Live lookups when scoretaking is internal', async () => {
    mockScoretaking.mockResolvedValue('internal');
    await renderSettings();
    generate();

    expect(readSettings()?.liveResultsMode).toBe('ilr');
    expect(mockWcaLiveId).not.toHaveBeenCalled();
  });

  it('stays on WCA Live and looks its id up when scoretaking is wca_live', async () => {
    mockScoretaking.mockResolvedValue('wca_live');
    mockWcaLiveId.mockResolvedValue('9667');
    await renderSettings();
    generate();

    // The submit waits on the person-id lookup it started, so the save lands a tick later.
    await waitFor(() => expect(readSettings()?.wcaLiveId).toBe('9667'));
    expect(readSettings()?.liveResultsMode).toBe('wca-live');
  });

  // The organizer may know about a switch before the WCA record does.
  it('does not overwrite a restored choice', async () => {
    mockScoretaking.mockResolvedValue('wca_live');
    writeSettings(stored({ liveResultsMode: 'ilr' }));
    await renderSettings();
    generate();

    expect(readSettings()?.liveResultsMode).toBe('ilr');
  });

  // The mode only decides where the name tag QR codes point, so it must be reachable whenever
  // name tags are generated, scorecards or not.
  it('is reachable when name tags are generated without scorecards', async () => {
    writeScope({
      mode: 'latest',
      documents: { scorecards: false, scheduleTracker: false, nametags: true, roundChecklist: false, firstTimerSlips: false, groupOverview: false },
    }, { showSecondRoundMode: false, multiStage: false });
    await renderSettings();

    expect(screen.getByRole('radio', { name: /Integrated live results/ })).toBeTruthy();
    expect(screen.queryByText(/Hide the WCA Live line/)).toBeNull();
  });

  it('lets the organizer override the detected system', async () => {
    mockScoretaking.mockResolvedValue('wca_live');
    await renderSettings();
    fireEvent.click(screen.getByRole('radio', { name: /Integrated live results/ }));
    generate();

    expect(readSettings()?.liveResultsMode).toBe('ilr');
  });
});

describe('finals station numbers', () => {
  const box = () => screen.getByRole('checkbox', { name: 'Print station numbers' }) as HTMLInputElement;
  const count = () => screen.getByRole('textbox', { name: 'Stations per stage' }) as HTMLInputElement;

  it('shows the detected count and saves a digits-only override', async () => {
    writeScope(DEFAULT_SCOPE, { showSecondRoundMode: false, multiStage: false, detectedStations: 16 });
    await renderSettings();
    fireEvent.click(advancedToggle());

    expect(screen.getByText(/the 16 stations found/)).toBeTruthy();
    expect(count().placeholder).toBe('16');
    fireEvent.change(count(), { target: { value: '1a2' } });
    generate();
    expect(readSettings()).toMatchObject({ finalStationNumbers: true, stationsPerStage: 12 });
  });

  it('unticking disables the count and an emptied count saves null', async () => {
    writeSettings(stored({ stationsPerStage: 8 }));
    await renderSettings();
    fireEvent.click(advancedToggle());

    fireEvent.change(count(), { target: { value: '' } });
    fireEvent.click(box());
    expect(count().disabled).toBe(true);
    generate();
    expect(readSettings()).toMatchObject({ finalStationNumbers: false, stationsPerStage: null });
  });
});

// Colour-coded paper per stage. The checkbox is hidden unless the scope step actually saw more
// than one stage, because the split cannot do anything for a single-room competition.
describe('per-stage PDF split', () => {
  // The accessible name is the whole label, description included.
  const box = () => screen.queryByRole('checkbox', { name: /One PDF per stage/ });

  it('is hidden when the competition runs on one stage', async () => {
    writeSettings(stored());
    await renderSettings();
    fireEvent.click(advancedToggle());
    expect(box()).toBeNull();
  });

  it('is offered and saved when the competition runs on several stages', async () => {
    writeScope(DEFAULT_SCOPE, { showSecondRoundMode: false, multiStage: true });
    writeSettings(stored());
    await renderSettings();
    fireEvent.click(advancedToggle());

    fireEvent.click(box()!);
    generate();
    expect(readSettings()?.splitPdfsByStage).toBe(true);
  });

  it('restores as ticked on the way back from /generate', async () => {
    writeScope(DEFAULT_SCOPE, { showSecondRoundMode: false, multiStage: true });
    writeSettings(stored({ splitPdfsByStage: true }));
    await renderSettings();
    fireEvent.click(advancedToggle());
    expect((box() as HTMLInputElement).checked).toBe(true);
  });

  // Prefilled round 2 has no stage to split on. Not an error, but the one unsplit file in an
  // otherwise per-stage set needs saying out loud.
  it('warns once ticked that a prefilled round 2 stays in one PDF', async () => {
    writeScope(DEFAULT_SCOPE, { showSecondRoundMode: true, multiStage: true });
    writeSettings(stored({ secondRoundMode: 'prefilled' }));
    await renderSettings();
    fireEvent.click(advancedToggle());

    expect(screen.queryByText(/stays one PDF/i)).toBeNull();
    fireEvent.click(box()!);
    expect(screen.getByText(/stays one PDF/i)).toBeTruthy();
  });

  it('does not warn when round 2 prints blanks, which do carry a stage', async () => {
    writeScope(DEFAULT_SCOPE, { showSecondRoundMode: true, multiStage: true });
    writeSettings(stored({ secondRoundMode: 'blanks', splitPdfsByStage: true }));
    await renderSettings();
    fireEvent.click(advancedToggle());
    expect(screen.queryByText(/stays one PDF/i)).toBeNull();
  });
});

describe('one PDF for all rounds', () => {
  const box = () => screen.getByRole('checkbox', { name: /One PDF for all rounds/ }) as HTMLInputElement;

  it('is seeded from the preset and saved', async () => {
    writePresetSettings({ mergeScorecardRounds: true });
    await renderSettings();
    fireEvent.click(advancedToggle());
    expect(box().checked).toBe(true);
    generate();
    expect(readSettings()?.mergeScorecardRounds).toBe(true);
  });

  it('takes the preset over a blob saved before the setting existed', async () => {
    writePresetSettings({ mergeScorecardRounds: true });
    const old = stored();
    delete old.mergeScorecardRounds;
    writeSettings(old);
    await renderSettings();
    fireEvent.click(advancedToggle());
    expect(box().checked).toBe(true);
  });

  // The stage-split toggle is hidden there, so nothing could undo a restored `true`.
  it('ignores a restored stage split on a single-stage competition', async () => {
    writeSettings(stored({ splitPdfsByStage: true, mergeScorecardRounds: true }));
    await renderSettings();
    fireEvent.click(advancedToggle());
    expect(box().disabled).toBe(false);
    expect(box().checked).toBe(true);
    generate();
    expect(readSettings()?.splitPdfsByStage).toBe(false);
  });

  it('greys out and says why once scorecards are split per stage', async () => {
    writeScope(DEFAULT_SCOPE, { showSecondRoundMode: false, multiStage: true });
    writeSettings(stored({ mergeScorecardRounds: true }));
    await renderSettings();
    fireEvent.click(advancedToggle());
    expect(box().disabled).toBe(false);

    fireEvent.click(screen.getByRole('checkbox', { name: /One PDF per stage/ }));
    expect(box().disabled).toBe(true);
    expect(box().checked).toBe(false);
    expect(screen.getByText(/Not available while scorecards are split per stage/)).toBeTruthy();
  });
});

// `on_the_spot_registration` seeds the blanks and shows what to fix by hand.
describe('on-the-spot registration', () => {
  const box = () => screen.getByRole('checkbox', { name: /Add blanks for on-the-spot/ }) as HTMLInputElement;

  it('ticks the blanks and shows the notice when the competition takes OTS', async () => {
    mockScoretaking.mockResolvedValue('wca_live', true);
    await renderSettings();

    expect(await screen.findByText(/accepts on-the-spot registrations/)).toBeTruthy();
    expect(box().checked).toBe(true);
    generate();
    expect(readSettings()?.otsBlanks).toBe(true);
  });

  it('shows neither when it does not', async () => {
    await renderSettings();

    expect(screen.queryByText(/accepts on-the-spot registrations/)).toBeNull();
    expect(box().checked).toBe(false);
  });

  it('keeps a restored choice over the detected flag', async () => {
    mockScoretaking.mockResolvedValue('wca_live', true);
    writeSettings(stored({ otsBlanks: false }));
    await renderSettings();
    await screen.findByText(/accepts on-the-spot registrations/);
    generate();

    expect(readSettings()?.otsBlanks).toBe(false);
  });
});

// A6 only reshapes the scorecards, so the notice must say the rest stays on the paper format.
describe('A6 scorecards', () => {
  const box = () => screen.getByRole('checkbox', { name: /Scorecards on A6/ }) as HTMLInputElement;
  const notice = () => screen.queryByText(/Only the scorecard PDFs are affected/);

  it('shows the notice, naming the paper format, only once ticked', async () => {
    await renderSettings();
    expect(box().checked).toBe(false);
    expect(notice()).toBeNull();

    fireEvent.click(box());
    expect(notice()?.textContent).toMatch(/still generated on Letter/);
    generate();
    expect(readSettings()?.scorecardsA6).toBe(true);
  });
});
