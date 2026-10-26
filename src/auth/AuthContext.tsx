import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { generatePKCE, generateState } from './pkce';
import { AuthContext, STORAGE_RETURN } from './useAuth';
import {
  WCA_OAUTH_URL,
  CLIENT_ID,
  REDIRECT_URI,
  type WCAToken,
  type WCAUser,
  exchangeCodeForToken,
  fetchMe,
  isExpired,
  refreshAccessToken,
  setOnAuthExpired,
} from './wca';
import { buildSessionEvent, send } from '../lib/analytics';
import { clearFlow } from '../lib/flowState';
import { clearWcifCache } from '../lib/wcifCache';

const STORAGE_TOKEN = 'wca_token';
const STORAGE_USER = 'wca_user';
const STORAGE_RENEW_ATTEMPT = 'renew_attempt';

/** A second redirect this soon means the fresh token 401s too. Sign out rather than loop. */
const RENEW_COOLDOWN_MS = 30_000;

/** A half-written blob must not white-screen the app on mount. Mirrors flowState.readJson. */
function readStored<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<WCAToken | null>(() => readStored<WCAToken>(STORAGE_TOKEN));
  const [user, setUser] = useState<WCAUser | null>(() => readStored<WCAUser>(STORAGE_USER));
  const [isLoading, setIsLoading] = useState(false);
  const [isRenewing, setIsRenewing] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    if (token) sessionStorage.setItem(STORAGE_TOKEN, JSON.stringify(token));
    else sessionStorage.removeItem(STORAGE_TOKEN);
  }, [token]);

  useEffect(() => {
    if (user) sessionStorage.setItem(STORAGE_USER, JSON.stringify(user));
    else sessionStorage.removeItem(STORAGE_USER);
  }, [user]);

  const login = useCallback(async () => {
    const { verifier, challenge } = await generatePKCE();
    const state = generateState();
    sessionStorage.setItem('pkce_verifier', verifier);
    sessionStorage.setItem('oauth_state', state);

    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: 'public manage_competitions',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
    });
    window.location.href = `${WCA_OAUTH_URL}?${params}`;
  }, []);

  const renewing = useRef(false);

  /**
   * The single recovery path for a dead token, reached from tab refocus, mount, and any 401.
   * Refresh grant first; the authorize redirect is the fallback, and it needs no interaction
   * because WCA still holds the session cookie and the prior consent.
   */
  const renew = useCallback(async () => {
    if (renewing.current) return;
    const stored = readStored<WCAToken>(STORAGE_TOKEN);
    if (!stored) return;

    renewing.current = true;
    setIsRenewing(true);
    try {
      if (stored.refresh_token) {
        try {
          setToken(await refreshAccessToken(stored.refresh_token));
          sessionStorage.removeItem(STORAGE_RENEW_ATTEMPT);
          return;
        } catch {
          // Spent or revoked. Fall through to the redirect.
        }
      }

      if (Date.now() - Number(sessionStorage.getItem(STORAGE_RENEW_ATTEMPT) ?? 0) < RENEW_COOLDOWN_MS) {
        setToken(null);
        setUser(null);
        setAuthError('session_expired');
        return;
      }
      sessionStorage.setItem(STORAGE_RENEW_ATTEMPT, String(Date.now()));
      sessionStorage.setItem(STORAGE_RETURN, window.location.pathname + window.location.search);
      await login();
    } finally {
      renewing.current = false;
      setIsRenewing(false);
    }
  }, [login]);

  // One registration covers every authed call, current and future, instead of a 401 check
  // repeated in each page.
  useEffect(() => {
    setOnAuthExpired(() => void renew());
    return () => setOnAuthExpired(null);
  }, [renew]);

  // Coming back to a tab left open past the 2h token life is the reported case. Checking on
  // mount as well covers a reload after the same wait.
  useEffect(() => {
    function check() {
      if (document.visibilityState !== 'visible') return;
      const stored = readStored<WCAToken>(STORAGE_TOKEN);
      if (stored && isExpired(stored)) void renew();
    }
    check();
    document.addEventListener('visibilitychange', check);
    return () => document.removeEventListener('visibilitychange', check);
  }, [renew]);

  async function handleCallback(code: string, returnedState: string) {
    const savedState = sessionStorage.getItem('oauth_state');
    const verifier = sessionStorage.getItem('pkce_verifier');
    sessionStorage.removeItem('oauth_state');
    sessionStorage.removeItem('pkce_verifier');

    if (returnedState !== savedState) throw new Error('OAuth state mismatch - possible CSRF');
    if (!verifier) throw new Error('Missing PKCE verifier');

    // Only renew() redirects with a token still stored; a fresh sign-in starts without one.
    const isRenewal = readStored<WCAToken>(STORAGE_TOKEN) !== null;

    setIsLoading(true);
    try {
      const newToken = await exchangeCodeForToken(code, verifier);
      setToken(newToken);
      const me = await fetchMe(newToken.access_token);
      setUser(me);
      setAuthError(null);
      sessionStorage.removeItem(STORAGE_RENEW_ATTEMPT);
      // Once per sign-in, carrying nothing but the fact that one happened. Lets us compare
      // organizers who start the flow against those who reach a download.
      if (!isRenewal) send(buildSessionEvent());
    } finally {
      setIsLoading(false);
    }
  }

  function logout() {
    setToken(null);
    setUser(null);
    setAuthError(null);
    sessionStorage.removeItem(STORAGE_RENEW_ATTEMPT);
    clearFlow();
    clearWcifCache();
  }

  return (
    <AuthContext.Provider
      value={{ token, user, isLoading, isRenewing, authError, login, logout, handleCallback }}
    >
      {children}
    </AuthContext.Provider>
  );
}
