import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';

// Set before the import: server.js reads the secret once, at module load.
process.env.WCA_CLIENT_SECRET = 'test-secret';
const { app } = await import('./server.js');

// Three security contracts live in headers and status codes rather than in any function a
// unit test can call: the CSP directives (dropping one ships silently), /api/event's
// answer-204-to-everything, and a missing file 404ing instead of returning index.html.

let server;
let base;

beforeAll(async () => {
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise(resolve => server.close(resolve)));

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.unstubAllGlobals());

const get = (p, init) => fetch(`${base}${p}`, init);
const postJson = (p, body) => get(p, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

describe('security headers', () => {
  it('locks the page down by default and allows only what the app needs', async () => {
    const csp = (await get('/')).headers.get('content-security-policy');

    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("script-src-attr 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
  });

  it('allows both WCA origins the app fetches from, and nothing else', async () => {
    const csp = (await get('/')).headers.get('content-security-policy');
    const connect = csp.split(';').find(d => d.trim().startsWith('connect-src'));

    // Losing either of these breaks sign-in or the nametag QR lookup at runtime only.
    expect(connect).toContain('https://www.worldcubeassociation.org');
    expect(connect).toContain('https://live.worldcubeassociation.org');
    expect(connect).toContain("'self'");
  });

  it('allows the PDF renderer its wasm and keeps fonts self-hosted', async () => {
    const csp = (await get('/')).headers.get('content-security-policy');
    // @react-pdf compiles through wasm; without this the download fails in production only.
    expect(csp).toContain("'wasm-unsafe-eval'");
    // A third-party font CDN leaks every visitor's IP (GDPR).
    expect(csp).not.toContain('fonts.googleapis.com');
    expect(csp).not.toContain('fonts.gstatic.com');
  });

  it('does not announce the server framework', async () => {
    expect((await get('/')).headers.get('x-powered-by')).toBeNull();
  });
});

describe('/api/event', () => {
  const valid = { v: 1, event: 'session' };

  const logged = () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    return () => spy.mock.calls.map(c => JSON.parse(c[0]));
  };

  it('logs a well-formed event for the BigQuery sink', async () => {
    const lines = logged();
    expect((await postJson('/api/event', valid)).status).toBe(204);

    const [line] = lines();
    expect(line).toMatchObject({ v: 1, event: 'session', component: 'analytics', severity: 'INFO' });
  });

  it('answers 204 to a malformed body and logs nothing', async () => {
    const lines = logged();
    expect((await postJson('/api/event', { event: 'not-a-real-kind' })).status).toBe(204);
    expect(lines()).toHaveLength(0);
  });

  it('answers 204 to a body that is not JSON at all', async () => {
    // Express would otherwise answer 400 with a stack trace, which leaks the endpoint shape.
    const lines = logged();
    expect((await postJson('/api/event', '{not json')).status).toBe(204);
    expect(lines()).toHaveLength(0);
  });

  it('answers 204 to an oversized body rather than 413', async () => {
    const lines = logged();
    const huge = { v: 1, event: 'session', pad: 'x'.repeat(4096) };
    expect((await postJson('/api/event', huge)).status).toBe(204);
    expect(lines()).toHaveLength(0);
  });

  it('cannot be made to spoof the log sink filter or the severity', async () => {
    // Fields are spread before the literals precisely so this is impossible.
    const lines = logged();
    await postJson('/api/event', { ...valid, component: 'billing', severity: 'CRITICAL' });

    const [line] = lines();
    expect(line.component).toBe('analytics');
    expect(line.severity).toBe('INFO');
  });
});

describe('/wca-token', () => {
  it('injects the client secret and passes the upstream status through', async () => {
    // The server calls the same global fetch this test does, so hold the real one
    // before stubbing the upstream call out.
    const realFetch = globalThis.fetch;
    const upstream = vi.fn().mockResolvedValue({
      status: 201, text: async () => '{"access_token":"tok"}',
    });
    vi.stubGlobal('fetch', upstream);

    const res = await realFetch(`${base}/wca-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=authorization_code&code=abc',
    });

    expect(res.status).toBe(201);
    expect(await res.text()).toBe('{"access_token":"tok"}');

    const [url, init] = upstream.mock.calls[0];
    expect(url).toBe('https://www.worldcubeassociation.org/oauth/token');
    // The whole reason this proxy exists: the secret is added here, never in the browser.
    const sent = new URLSearchParams(init.body);
    expect(sent.get('client_secret')).toBe('test-secret');
    expect(sent.get('code')).toBe('abc');
  });

  it('answers 502 when the WCA cannot be reached', async () => {
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    const res = await realFetch(`${base}/wca-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=authorization_code',
    });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'Token exchange failed' });
  });

  it('still forwards when no form body is sent', async () => {
    const realFetch = globalThis.fetch;
    const upstream = vi.fn().mockResolvedValue({ status: 400, text: async () => '{}' });
    vi.stubGlobal('fetch', upstream);

    const res = await realFetch(`${base}/wca-token`, { method: 'POST' });
    expect(res.status).toBe(400);
  });
});

describe('routing', () => {
  it('404s a missing file instead of serving the SPA under a 200', async () => {
    // Falling through would answer a request for a missing bundle with HTML, and the
    // browser would report a syntax error somewhere unrelated.
    const res = await get('/assets/does-not-exist.js');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('text/plain');
    expect(await res.text()).toBe('Not found');
  });

  it('404s a missing file at the root too', async () => {
    expect((await get('/nope.png')).status).toBe(404);
  });

  const hasBuild = existsSync(path.join(import.meta.dirname, 'dist', 'index.html'));

  it.runIf(hasBuild)('serves the SPA uncached for an extensionless route', async () => {
    const res = await get('/scope');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    // no-store, or a deploy leaves browsers holding an index.html that names old bundles.
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it.runIf(!hasBuild)('explains itself when dist/ was never built', async () => {
    const res = await get('/scope');
    expect(res.status).toBe(500);
    expect(await res.text()).toContain('run npm run build first');
  });
});
