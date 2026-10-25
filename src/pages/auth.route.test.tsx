import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import i18n from '../i18n/index';
import { STORAGE_RETURN } from '../auth/useAuth';
import { organizer, sampleWcif } from '../test/fixtures';
import { addCompetition, backend } from '../test/fakeWca';
import { seedCompetition } from '../test/journeys';
import { currentPath, renderApp } from '../test/renderApp';

// The return leg of the OAuth redirect: WCA sends the browser to /auth/callback with a code
// (or an error), and the page trades it for a token through the same-origin /wca-token proxy.

/** The page reads window.location, as it must under BrowserRouter, so the URL is set there too. */
function returnFromWca(query: string, { state = 'expected-state' } = {}) {
  sessionStorage.setItem('oauth_state', state);
  sessionStorage.setItem('pkce_verifier', 'verifier');
  window.history.replaceState({}, '', `/auth/callback?${query}`);
  renderApp(`/auth/callback?${query}`, { user: null });
}

const signInFailed = () => screen.findByText(i18n.t('errors.sign_in_failed'));

describe('coming back from WCA', () => {
  it('signs in and opens the competition list', async () => {
    addCompetition(sampleWcif());
    returnFromWca('code=good-code&state=expected-state');
    await waitFor(() => expect(currentPath()).toBe('/competitions'));
    expect(JSON.parse(sessionStorage.getItem('wca_user')!).name).toBe(organizer.name);
    expect(sessionStorage.getItem('pkce_verifier')).toBeNull();
    // The verifier went to the proxy, never a client secret.
    expect(backend.calls).toContain('POST http://localhost:3000/wca-token');
  });

  it('resumes where a renewal left the organizer', async () => {
    seedCompetition();
    sessionStorage.setItem(STORAGE_RETURN, '/scope');
    returnFromWca('code=good-code&state=expected-state');
    await waitFor(() => expect(currentPath()).toBe('/scope'));
    // Consumed, so an ordinary sign-in later is not dragged back here.
    expect(sessionStorage.getItem(STORAGE_RETURN)).toBeNull();
  });

  it.each([
    ['a state that does not match (CSRF)', 'code=good-code&state=forged'],
    ['a code WCA rejects', 'code=bad-code&state=expected-state'],
    ['the organizer declining on WCA', 'error=access_denied&state=expected-state'],
    ['no code at all', 'state=expected-state'],
  ])('lands on the login page with a sign-in error after %s', async (_case, query) => {
    returnFromWca(query);
    await signInFailed();
    expect(currentPath().startsWith('/?error=')).toBe(true);
    expect(sessionStorage.getItem('wca_token')).toBeNull();
  });
});
