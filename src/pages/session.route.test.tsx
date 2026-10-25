import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import i18n from '../i18n/index';
import { writeSettings } from '../lib/flowState';
import * as analytics from '../lib/analytics';
import { freshToken, sampleWcif, testSettings } from '../test/fixtures';
import { addCompetition, backend } from '../test/fakeWca';
import { SAMPLE, seedCompetition } from '../test/journeys';
import { currentPath, renderApp } from '../test/renderApp';

// An organizer leaves the tab past the token's 2h life and reloads mid-wizard. The provider
// renews on mount; the page under it must come back on the new token, not strand them on the
// session-expired error the dead token earned.

const dead = freshToken({ access_token: 'dead-token', created_at: Math.floor(Date.now() / 1000) - 3 * 3600 });

describe('a token that expired while away', () => {
  it('recovers on /scope after the silent renewal', async () => {
    seedCompetition();
    renderApp('/scope', { token: dead });
    expect(await screen.findByRole('button', { name: i18n.t('scope.continue') })).toBeTruthy();
    expect(screen.queryByText(i18n.t('errors.session_expired'))).toBeNull();
  });

  it('reports no load error for the 401 that starts the renewal', async () => {
    const send = vi.spyOn(analytics, 'send');
    seedCompetition();
    renderApp('/scope', { token: dead });
    await screen.findByRole('button', { name: i18n.t('scope.continue') });
    expect(send.mock.calls.filter(([e]) => e.event === 'error')).toEqual([]);
  });

  it('recovers on /generate after the silent renewal', async () => {
    seedCompetition();
    writeSettings(testSettings({ competitionId: SAMPLE.id }));
    renderApp('/generate', { token: dead });
    expect(await screen.findByRole('button', { name: i18n.t('generate.download_button') })).toBeTruthy();
    expect(screen.queryByText(i18n.t('errors.session_expired'))).toBeNull();
  });

  it('renews with the refresh token, and stores the rotated one', async () => {
    seedCompetition();
    renderApp('/scope', { token: dead });
    await screen.findByRole('button', { name: i18n.t('scope.continue') });
    const stored = JSON.parse(sessionStorage.getItem('wca_token')!);
    expect(stored.access_token).not.toBe('dead-token');
    expect(stored.refresh_token).toBe(backend.refreshToken);
  });

  // No remount and no tab switch: the token simply runs out while the picker sits open. Only
  // the 401 on the next request can start the renewal, so the page must make that request.
  it('recovers when it runs out while the organizer is still in the app', async () => {
    addCompetition(sampleWcif());
    renderApp('/competitions');
    const pick = await screen.findByText(SAMPLE.name);
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(Date.now() + 3 * 3600_000);
      fireEvent.click(pick);
      expect(await screen.findByRole('button', { name: i18n.t('scope.continue') })).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});

// A bookmark, a new tab or a restored session lands on a later step with nothing picked yet.
describe('a wizard step opened with no competition picked', () => {
  it.each(['/scope', '/settings', '/generate'])('%s sends the organizer to the picker', async (path) => {
    renderApp(path);
    await waitFor(() => expect(currentPath()).toBe('/competitions'));
  });
});
