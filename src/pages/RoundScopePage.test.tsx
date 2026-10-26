// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';

vi.mock('../auth/wca', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../auth/wca')>()),
  fetchWcif: vi.fn(),
}));

vi.mock('../lib/analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/analytics')>()),
  send: vi.fn(),
}));

import { fetchWcif } from '../auth/wca';
import { send } from '../lib/analytics';
import i18n from '../i18n/index';
import { markAllSeen } from '../changelog';
import { writeCompetition, readHasGroups, readStoredScope } from '../lib/flowState';
import { PRESETS, readPresetId } from '../presets';
import { sampleWcif } from '../test/fixtures';
import { renderWithProviders, signedInAuth, useEnglish } from '../test/render';
import RoundScopePage from './RoundScopePage';

const mockWcif = vi.mocked(fetchWcif);

// Mount smoke test, on the real fixture WCIF: this is the only test that runs a
// fetched WCIF through parseWCIF and into a rendered page.

beforeEach(async () => {
  sessionStorage.clear();
  localStorage.clear();
  markAllSeen();
  await useEnglish();
  vi.clearAllMocks();
  mockWcif.mockResolvedValue(sampleWcif());
  writeCompetition('GrosJouetsaMontreal2026', 'Gros Jouets à Montréal 2026');
});
afterEach(cleanup);

describe('RoundScopePage', () => {
  it('renders the document choices once the WCIF loads', async () => {
    renderWithProviders(<RoundScopePage />, { auth: signedInAuth });

    expect(await screen.findByText(i18n.t('scope.docs_title'))).toBeTruthy();
    expect(mockWcif).toHaveBeenCalledWith('GrosJouetsaMontreal2026', 'test-token');
    expect(screen.getByRole('button', { name: i18n.t('scope.continue') })).toBeTruthy();
    // Nothing is written until Continue.
    expect(readStoredScope()).toBeNull();
  });

  // Opt-in by request: it is only useful once groups exist, and most organizers print it
  // separately from the scorecard pile.
  it('offers the Group Overview unchecked', async () => {
    renderWithProviders(<RoundScopePage />, { auth: signedInAuth });

    const label = await screen.findByText(i18n.t('scope.doc_group_overview'));
    const box = label.closest('label')!.querySelector('input[type=checkbox]') as HTMLInputElement;
    expect(box.checked).toBe(false);
  });

  it('writes the document selection Continue was pressed with', async () => {
    renderWithProviders(<RoundScopePage />, { auth: signedInAuth });
    await screen.findByText(i18n.t('scope.docs_title'));

    // The fixture is mid-competition, so the nametag default depends on that; assert the
    // toggle flips it rather than pinning the default, which baseDocuments owns.
    const box = screen.getByLabelText(i18n.t('scope.doc_nametags')) as HTMLInputElement;
    const before = box.checked;
    fireEvent.click(box);
    fireEvent.click(screen.getByRole('button', { name: i18n.t('scope.continue') }));

    // /settings and /generate both read this; a toggle that never lands here is invisible
    // until the organizer opens a bundle missing a document.
    const scope = readStoredScope()!;
    expect(scope.documents.nametags).toBe(!before);
    expect(scope.documents.scorecards).toBe(true);
  });

  it('refuses to continue with no documents selected', async () => {
    renderWithProviders(<RoundScopePage />, { auth: signedInAuth });
    await screen.findByText(i18n.t('scope.docs_title'));

    for (const key of [
      'scope.doc_scorecards', 'scope.doc_schedule', 'scope.doc_nametags',
      'scope.doc_round_checklist', 'scope.doc_first_timers',
    ] as const) {
      const box = screen.getByLabelText(i18n.t(key)) as HTMLInputElement;
      if (box.checked) fireEvent.click(box);
    }

    const button = screen.getByRole('button', { name: i18n.t('scope.continue') }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    // An empty bundle would reach /generate and render a download button for nothing.
    expect(readStoredScope()).toBeNull();
  });

  it('records whether the competition already has groups, for the settings warning', async () => {
    renderWithProviders(<RoundScopePage />, { auth: signedInAuth });
    await screen.findByText(i18n.t('scope.docs_title'));
    // The fixture assigns groups, and /settings must not re-fetch the WCIF to learn this.
    expect(readHasGroups()).toBe(true);
  });

  /*
   * The preset picker is a custom tile, not a labelled radio: the native input is still
   * in the DOM but transparent, so the radio group keeps its accessible name and its
   * keyboard behaviour. Hiding that input with display:none or visibility:hidden would
   * take both away silently, hence these two.
   */
  describe('the preset tiles', () => {
    it('expose a real radio group a screen reader can name', async () => {
      renderWithProviders(<RoundScopePage />, { auth: signedInAuth });
      await screen.findByText(i18n.t('scope.presets_title'));

      const radios = screen.getAllByRole('radio', { name: new RegExp(PRESETS[0].name) });
      expect(radios.length).toBe(1);
      expect(radios[0].tagName).toBe('INPUT');
    });

    it('applies the preset that was picked', async () => {
      renderWithProviders(<RoundScopePage />, { auth: signedInAuth });
      await screen.findByText(i18n.t('scope.presets_title'));

      fireEvent.click(screen.getAllByRole('radio', { name: new RegExp(PRESETS[0].name) })[0]);
      fireEvent.click(screen.getByRole('button', { name: i18n.t('scope.continue') }));

      expect(readPresetId()).toBe(PRESETS[0].id);
    });
  });

  it('surfaces a WCIF fetch failure instead of hanging on the skeleton', async () => {
    mockWcif.mockRejectedValue(new Error('boom'));
    // wcifCache is module-level and outlives a test: a competition the previous
    // test loaded would be served from cache and never hit the failing fetch.
    writeCompetition('Uncached2026', 'Uncached 2026');
    renderWithProviders(<RoundScopePage />, { auth: signedInAuth });

    expect(await screen.findByText(/boom/)).toBeTruthy();
    // The first fetch happens here, so this is the only place it can be reported.
    expect(vi.mocked(send)).toHaveBeenCalledWith(expect.objectContaining({
      event: 'error', comp: { id: 'Uncached2026' }, stage: 'fetch',
    }));
  });
});
