// WCA's /oauth/token, for server.js to proxy to under WCA_ORIGIN. The browser-side WCA API is
// faked in the page (fakeWca.ts); this is the one call that leaves from the server.
// Checks what Doorkeeper checks: client, redirect URI, the PKCE verifier against the challenge
// the code carries, and that a refresh token is spent once. GET /calls lists every form received.

import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import {
  CLIENT_ID, CLIENT_SECRET, FAKE_WCA_PORT, REDIRECT_URI, accessToken, parseAuthCode,
} from './protocol.ts';

const calls: Record<string, string>[] = [];
const spent = new Set<string>();
let minted = 0;

function token(expiresIn = 7200) {
  minted += 1;
  const now = Date.now();
  return {
    access_token: accessToken(minted, now + expiresIn * 1000), refresh_token: `e2e-refresh-${minted}`,
    token_type: 'Bearer', expires_in: expiresIn, scope: 'public manage_competitions',
    created_at: Math.floor(now / 1000),
  };
}

const challengeOf = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');

function exchange(form: Record<string, string>): [number, unknown] {
  if (form['client_id'] !== CLIENT_ID || form['client_secret'] !== CLIENT_SECRET) return [401, { error: 'invalid_client' }];
  if (form['grant_type'] === 'refresh_token') {
    const refresh = form['refresh_token'] ?? '';
    if (!/^e2e-refresh-\d+$/.test(refresh) || spent.has(refresh)) return [400, { error: 'invalid_grant' }];
    spent.add(refresh);
    return [200, token()];
  }
  const code = parseAuthCode(form['code'] ?? '');
  if (!code || form['redirect_uri'] !== REDIRECT_URI || challengeOf(form['code_verifier'] ?? '') !== code.challenge) {
    return [400, { error: 'invalid_grant' }];
  }
  if (code.outcome === 'down') return [503, { error: 'unavailable' }];
  return [200, token(code.outcome === 'short' ? 30 : 7200)];
}

createServer((req, res) => {
  const send = ([status, body]: [number, unknown]) =>
    res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
  if (req.method === 'GET' && req.url === '/calls') return send([200, calls]);
  if (req.method !== 'POST' || req.url !== '/oauth/token') return send([404, { error: `fake WCA has no ${req.method} ${req.url}` }]);

  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const form = Object.fromEntries(new URLSearchParams(body));
    calls.push(form);
    send(exchange(form));
  });
}).listen(FAKE_WCA_PORT, '127.0.0.1', () => console.log(`fake WCA origin on ${FAKE_WCA_PORT}`));
