import { afterEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';

// server.js loads the client secret once, at import, from the env or else Secret Manager.
// Each case re-imports it under different env, so this lives apart from server.test.js.

const accessSecretVersion = vi.fn(async () => [{ payload: { data: Buffer.from('from-secret-manager') } }]);
vi.mock('@google-cloud/secret-manager', () => ({
  SecretManagerServiceClient: class { accessSecretVersion = accessSecretVersion; },
}));

/** The client_secret server.js forwards to WCA, after importing it under `env`. */
async function forwardedSecret(env) {
  vi.resetModules();
  for (const k of ['WCA_CLIENT_SECRET', 'GOOGLE_CLOUD_PROJECT', 'GCLOUD_PROJECT']) vi.stubEnv(k, env[k] ?? '');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const { app } = await import('./server.js');

  const realFetch = globalThis.fetch;
  let sent = null;
  vi.stubGlobal('fetch', async (url, init) => {
    if (String(url).startsWith('https://www.worldcubeassociation.org/')) {
      sent = new URLSearchParams(init.body).get('client_secret');
      return new Response('{}', { status: 200 });
    }
    return realFetch(url, init);
  });

  const server = http.createServer(app).listen(0);
  await new Promise((r) => server.once('listening', r));
  try {
    await realFetch(`http://127.0.0.1:${server.address().port}/wca-token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=refresh_token',
    });
  } finally {
    await new Promise((r) => server.close(r));
  }
  return sent;
}

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); accessSecretVersion.mockClear(); });

describe('the WCA client secret', () => {
  it('comes from the env when set, without touching Secret Manager', async () => {
    expect(await forwardedSecret({ WCA_CLIENT_SECRET: 'from-env', GOOGLE_CLOUD_PROJECT: 'p' })).toBe('from-env');
    expect(accessSecretVersion).not.toHaveBeenCalled();
  });

  it.each(['GOOGLE_CLOUD_PROJECT', 'GCLOUD_PROJECT'])('comes from Secret Manager on App Engine (%s)', async (key) => {
    expect(await forwardedSecret({ [key]: 'compprint' })).toBe('from-secret-manager');
    expect(accessSecretVersion).toHaveBeenCalledWith({
      name: 'projects/compprint/secrets/WCA_CLIENT_SECRET/versions/latest',
    });
  });

  it('is left out, with a warning, when neither exists', async () => {
    expect(await forwardedSecret({})).toBeNull();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('WCA_CLIENT_SECRET is not set'));
  });
});
