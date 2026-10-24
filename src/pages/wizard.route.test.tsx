import { describe, expect, it } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import i18n from '../i18n/index';
import { readCompetition, readSettings, readStoredScope } from '../lib/flowState';
import { buildPdfJobs, downloadTarget } from '../lib/pdfJobs';
import { filterParsedByScope } from '../lib/generationScope';
import { parseWCIF } from '../lib/wcif-parser';
import { sampleWcif, testSettings } from '../test/fixtures';
import { addCompetition, backend } from '../test/fakeWca';
import { currentPath, renderApp } from '../test/renderApp';
import { downloads } from '../test/routeSetup';
import { workers } from '../test/fakeWorker';

// flowState.test.ts covers the storage and each page test covers one page, so the joint -
// four steps agreeing about the same competition - is what nothing else sees.
//
// Drives the real routes and AuthProvider through the UI only, against the fake WCA in
// src/test/fakeWca.ts, and asserts what crossed a page boundary rather than what any page
// rendered.

const FAR_FUTURE = { start_date: '2999-05-16', end_date: '2999-05-16' };

function seed() {
  addCompetition(sampleWcif(), FAR_FUTURE);
  addCompetition({ ...sampleWcif(), id: 'AutreCompetition2026', name: 'Autre Compétition 2026' }, FAR_FUTURE);
}

const wcifFetches = () => backend.calls.filter(c => c.includes('/wcif/'));

const enter = (route: string, signedIn = true) => {
  seed();
  return renderApp(route, signedIn ? {} : { user: null });
};

// Callers pass i18n.t(...) so the key stays typed at the call site.
const click = async (name: string) =>
  fireEvent.click(await screen.findByRole('button', { name }));

/** A stat card renders its value above its label; read the value beside a known label. */
const statValue = (label: string) =>
  screen.getByText(label).previousSibling?.textContent;

/** Picker → scope → settings, driving only the UI. Leaves the caller on /settings. */
async function walkToSettings(name = 'Gros Jouets à Montréal 2026') {
  fireEvent.click(await screen.findByText(name));
  await click(i18n.t('scope.continue'));
  await screen.findByRole('button', { name: i18n.t('settings.generate_button') });
}

describe('the wizard carries one competition through all four steps', () => {
  it('reaches the download step with what the organizer actually picked', async () => {
    enter('/competitions');
    await walkToSettings();
    await click(i18n.t('settings.generate_button'));

    // Both come from buildPdfJobs, and must describe the competition chosen three steps back.
    const settings = readSettings()!;
    expect(settings.competitionId).toBe('GrosJouetsaMontreal2026');

    const scoped = filterParsedByScope(parseWCIF(sampleWcif(), settings), settings.generationScope);
    const jobs = buildPdfJobs(scoped, settings);
    const { filename } = downloadTarget(jobs, settings.competitionId);

    expect(await screen.findByRole('button', {
      name: i18n.t('generate.download_button'),
    })).toBeTruthy();
    // The filename is its own caption line now, so assert it survived the flow separately.
    expect(screen.getByText(filename)).toBeTruthy();
    expect(statValue(i18n.t('generate.stats.pdfs'))).toBe(String(jobs.length));
  });

  it('downloads the document the generate page promised', async () => {
    enter('/competitions');
    await walkToSettings();
    await click(i18n.t('settings.generate_button'));
    await click(i18n.t('generate.download_button'));

    await waitFor(() => expect(downloads).toHaveLength(1));
    const settings = readSettings()!;
    const jobs = buildPdfJobs(filterParsedByScope(parseWCIF(sampleWcif(), settings), settings.generationScope), settings);
    // The default scope is the scorecards alone, which ships as the PDF itself, not a zip.
    expect(jobs).toHaveLength(1);
    expect(downloads[0].filename).toBe(downloadTarget(jobs, settings.competitionId).filename);
    expect(await downloads[0].blob.text()).toBe('%PDF-fake');
    expect(workers.unhandled).toEqual([]);
    expect(currentPath()).toBe('/generate');
  });

  it('fetches the WCIF for the competition the picker wrote, not some other one', async () => {
    enter('/competitions');
    fireEvent.click(await screen.findByText('Autre Compétition 2026'));

    await waitFor(() => expect(wcifFetches()).toEqual([
      'GET https://www.worldcubeassociation.org/api/v0/competitions/AutreCompetition2026/wcif/version/2',
    ]));
    expect(readCompetition().id).toBe('AutreCompetition2026');
  });

  it('records the scope choice for the settings step to act on', async () => {
    enter('/competitions');
    await walkToSettings();
    // Written by /scope, read by /settings and /generate. Absent means the handoff broke.
    expect(readStoredScope()).not.toBeNull();
  });
});

describe('switching competitions', () => {
  it('drops the first competition\'s scope and settings', async () => {
    // The regression clearDownstream exists to prevent: A's scope generating B's documents.
    enter('/competitions');
    await walkToSettings();
    await click(i18n.t('settings.generate_button'));
    await screen.findByRole('button', { name: i18n.t('generate.download_button') });

    expect(readSettings()).not.toBeNull();
    expect(readStoredScope()).not.toBeNull();

    cleanup();
    renderApp('/competitions');
    fireEvent.click(await screen.findByText('Autre Compétition 2026'));

    await waitFor(() => expect(readCompetition().id).toBe('AutreCompetition2026'));
    expect(readSettings()).toBeNull();
    expect(readStoredScope()).toBeNull();
  });

  it('keeps everything when the same competition is picked again', async () => {
    enter('/competitions');
    await walkToSettings();
    await click(i18n.t('settings.generate_button'));
    await screen.findByRole('button', { name: i18n.t('generate.download_button') });

    cleanup();
    renderApp('/competitions');
    fireEvent.click(await screen.findByText('Gros Jouets à Montréal 2026'));

    // Same competition, so the organizer's earlier answers are theirs to come back to.
    await waitFor(() => expect(readStoredScope()).not.toBeNull());
    expect(readSettings()).not.toBeNull();
  });
});

describe('ProtectedRoute', () => {
  it.each(['/competitions', '/scope', '/settings', '/generate', '/custom'])(
    'sends a signed-out visitor at %s back to the login page',
    async (route) => {
      enter(route, false);
      expect(await screen.findByRole('button', { name: i18n.t('login.sign_in_button') })).toBeTruthy();
      expect(wcifFetches()).toEqual([]);
    },
  );

  it('lets a signed-in organizer through', async () => {
    enter('/competitions');
    expect(await screen.findByText('Gros Jouets à Montréal 2026')).toBeTruthy();
  });

  it('sends an unknown route back to the login page', async () => {
    enter('/nope', false);
    expect(await screen.findByRole('button', { name: i18n.t('login.sign_in_button') })).toBeTruthy();
  });
});

describe('the custom-competition branch', () => {
  it('reaches settings without a WCIF, and marks the settings as custom', async () => {
    enter('/competitions');
    fireEvent.click(await screen.findByRole('button', {
      name: new RegExp(i18n.t('picker.create_custom_title')),
    }));

    // The name input is labelled by a heading, not a <label>, so the placeholder is the handle.
    const name = await screen.findByPlaceholderText(i18n.t('custom.name_placeholder'));
    fireEvent.change(name, { target: { value: 'Club Meetup' } });

    // Continue stays disabled until at least one named event exists.
    await click(i18n.t('settings.advanced.add_custom_event'));
    fireEvent.change(
      screen.getByPlaceholderText(i18n.t('settings.advanced.event_name_placeholder')),
      { target: { value: 'Mystery Puzzle' } },
    );
    await click(i18n.t('custom.continue'));
    await click(i18n.t('settings.generate_button'));

    const settings = readSettings()!;
    expect(settings.isCustomCompetition).toBe(true);
    // A custom competition has no WCIF; fetching one would 404 on a real run.
    expect(wcifFetches()).toEqual([]);
  });
});

describe('settings defaults', () => {
  it('start from the fixture defaults, so a fresh run is generatable', async () => {
    enter('/competitions');
    await walkToSettings();
    await click(i18n.t('settings.generate_button'));

    const settings = readSettings()!;
    const defaults = testSettings();
    expect(settings.paperFormat).toBe(defaults.paperFormat);
    expect(settings.language).toBeTruthy();
  });
});
