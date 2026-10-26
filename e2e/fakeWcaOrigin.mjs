// WCA's /oauth/token, for server.js to proxy to under WCA_ORIGIN. The browser-side WCA API is
// faked in the page (e2e/fakeWca.ts); this is the one call that leaves from the server.
//
// Stateless, so a retried test sees the same answers: the code picks the outcome.
//   good-code → a token, short-code → one already inside the app's expiry skew,
//   down-code → 503, anything else → invalid_grant.
// GET /calls lists every form received, for asserting on the grant a renewal used.

import { createServer } from 'node:http';

const PORT = Number(process.env.FAKE_WCA_PORT ?? 4180);
const calls = [];
let minted = 0;

const token = (expiresIn = 7200) => {
  minted += 1;
  return {
    access_token: `e2e-token-${minted}`, refresh_token: `e2e-refresh-${minted}`,
    token_type: 'Bearer', expires_in: expiresIn, scope: 'public manage_competitions',
    created_at: Math.floor(Date.now() / 1000),
  };
};

createServer((req, res) => {
  const send = (status, body) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
  if (req.method === 'GET' && req.url === '/calls') return send(200, calls);
  if (req.method !== 'POST' || req.url !== '/oauth/token') return send(404, { error: `fake WCA has no ${req.method} ${req.url}` });

  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const form = Object.fromEntries(new URLSearchParams(body));
    calls.push(form);
    if (form.client_secret !== 'e2e-secret') return send(401, { error: 'invalid_client' });
    if (form.grant_type === 'refresh_token') {
      return form.refresh_token?.startsWith('e2e-refresh-') ? send(200, token()) : send(400, { error: 'invalid_grant' });
    }
    if (form.code === 'down-code') return send(503, { error: 'unavailable' });
    if (form.code === 'short-code') return send(200, token(1));
    return form.code === 'good-code' ? send(200, token()) : send(400, { error: 'invalid_grant' });
  });
}).listen(PORT, '127.0.0.1', () => console.log(`fake WCA origin on ${PORT}`));
