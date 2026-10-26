// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, waitFor } from '@testing-library/react';
import type { AuthState } from '../auth/useAuth';
import { anonymousAuth, renderWithProviders, useEnglish } from '../test/render';
import AuthCallbackPage from './AuthCallbackPage';

// The OAuth landing page reads window.location, not the router, and every path out of
// it is a redirect. Getting the guard wrong strands the organizer on a blank screen
// with their token in the URL, which no other test would catch.

const navigate = vi.fn();
vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router')>()),
  useNavigate: () => navigate,
}));

const handleCallback = vi.fn();
const auth = { ...anonymousAuth, handleCallback } as unknown as AuthState;

const land = (search: string) => {
  window.history.replaceState({}, '', `/auth/callback${search}`);
  return renderWithProviders(<AuthCallbackPage />, { auth, route: '/auth/callback' });
};

beforeEach(async () => {
  await useEnglish();
  sessionStorage.clear();
  vi.clearAllMocks();
  handleCallback.mockResolvedValue(undefined);
});
afterEach(cleanup);

// Resuming after a renewal and the failure paths run end to end in auth.route.test.tsx.
describe('AuthCallbackPage', () => {
  it('exchanges the code when the WCA sends one back', async () => {
    land('?code=abc&state=xyz');
    await waitFor(() => expect(handleCallback).toHaveBeenCalledWith('abc', 'xyz'));
  });

  it('falls back to the picker for an ordinary sign-in', async () => {
    land('?code=abc&state=xyz');
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/competitions', { replace: true }));
  });
});
