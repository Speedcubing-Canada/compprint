// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';

// CLIENT_ID is read from import.meta.env at module scope, so which half of this page
// renders is decided at import time. The test pins it both ways rather than inheriting
// whatever the developer's .env happens to hold - that divergence passes locally and
// fails in CI, where there is no .env.
const clientId = { value: 'test-client-id' };
vi.mock('../auth/wca', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../auth/wca')>()),
  get CLIENT_ID() { return clientId.value; },
}));

import i18n from '../i18n/index';
import { anonymousAuth, renderWithProviders, useEnglish } from '../test/render';
import type { AuthState } from '../auth/useAuth';
import LoginPage from './LoginPage';
import { APP_NAME } from '../brand';

// Mount smoke test: the sign-in screen is the one page every organizer sees, and
// it is the only one no other test touches. Assertions go through i18n keys, never
// literal copy, so rewording never reddens CI.

beforeEach(async () => {
  clientId.value = 'test-client-id';
  await useEnglish();
});
afterEach(cleanup);

const signIn = () => screen.queryByRole('button', { name: i18n.t('login.sign_in_button') });

describe('LoginPage', () => {
  it('renders the sign-in screen', () => {
    renderWithProviders(<LoginPage />);
    expect(screen.getByRole('heading', { name: APP_NAME })).toBeTruthy();
    expect(signIn()).toBeTruthy();
  });

  it('asks for setup instead of sign-in when the OAuth client id is missing', () => {
    clientId.value = '';
    renderWithProviders(<LoginPage />);
    expect(screen.getByText(i18n.t('login.setup_required'))).toBeTruthy();
    expect(signIn()).toBeNull();
  });
});


// Landing back here used to say nothing at all: the callback's ?error= was dropped on the
// floor, so a failed renewal looked like an ordinary sign-out.
describe('why the organizer is back here', () => {
  const withError = (authError: string | null) =>
    ({ ...anonymousAuth, authError }) as unknown as AuthState;

  it('says the session could not be renewed', () => {
    renderWithProviders(<LoginPage />, { auth: withError('session_expired') });
    expect(screen.getByRole('alert').textContent).toBe(i18n.t('errors.session_expired'));
  });

  it('reports a sign-in that never finished, without echoing the OAuth code', () => {
    renderWithProviders(<LoginPage />, { auth: withError(null), route: '/?error=access_denied' });

    expect(screen.getByRole('alert').textContent).toBe(i18n.t('errors.sign_in_failed'));
    expect(screen.queryByText(/access_denied/)).toBeNull();
  });

  it('stays quiet on a plain first visit', () => {
    renderWithProviders(<LoginPage />, { auth: withError(null) });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
