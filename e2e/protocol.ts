// The fake WCA's ports, ids and encodings. Codes and tokens carry what WCA would have stored, so
// the two fakes check PKCE and expiry without sharing state.

export const APP_PORT = 4173;
export const FAKE_WCA_PORT = 4180;
export const FAKE_WCA_ORIGIN = `http://127.0.0.1:${FAKE_WCA_PORT}`;
export const CLIENT_ID = 'e2e-client';
export const CLIENT_SECRET = 'e2e-secret';
export const REDIRECT_URI = `http://localhost:${APP_PORT}/auth/callback`;

/**
 * What the token endpoint does with a code. `short` issues a token already inside the app's 60s
 * expiry skew, which the API still accepts for 30s: the app must renew it unprompted.
 */
export type Outcome = 'good' | 'short' | 'down';

/** An authorization code: the outcome, and the PKCE challenge WCA would have stored beside it. */
export const authCode = (outcome: Outcome, challenge: string) => `${outcome}.${challenge}`;

export function parseAuthCode(code: string): { outcome: Outcome; challenge: string } | null {
  const m = code.match(/^(good|short|down)\.(.+)$/);
  return m ? { outcome: m[1] as Outcome, challenge: m[2]! } : null;
}

/** An access token that names its own expiry, so the page fake can refuse it once it lapses. */
export const accessToken = (n: number, expiresAt: number) => `e2e-token-${n}-${expiresAt}`;

export function accessTokenExpiry(token: string): number | null {
  const m = token.match(/^e2e-token-\d+-(\d+)$/);
  return m ? Number(m[1]) : null;
}
