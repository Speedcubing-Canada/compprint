import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import { sanitizeEvent } from './analytics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DIST_DIR = path.join(__dirname, 'dist');
const INDEX_PATH = path.join(DIST_DIR, 'index.html');
const PORT = Number(process.env.PORT || 8080);

// Secret Manager on App Engine: versions don't preserve console-set env vars across
// deploys, and the secret belongs in neither app.yaml nor CI. Locally, .env.
async function loadClientSecret() {
  if (process.env.WCA_CLIENT_SECRET) return process.env.WCA_CLIENT_SECRET;

  const projectId =
    process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
  if (!projectId) return '';

  const { SecretManagerServiceClient } = await import(
    '@google-cloud/secret-manager'
  );
  const client = new SecretManagerServiceClient();
  const [version] = await client.accessSecretVersion({
    name: `projects/${projectId}/secrets/WCA_CLIENT_SECRET/versions/latest`,
  });
  return version.payload.data.toString();
}

const WCA_CLIENT_SECRET = await loadClientSecret();
if (!WCA_CLIENT_SECRET) {
  console.warn(
    'WCA_CLIENT_SECRET is not set - /wca-token will return invalid_client',
  );
}

const app = express();
app.disable('x-powered-by');

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
        scriptSrcAttr: ["'none'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        fontSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https://www.worldcubeassociation.org'],
        connectSrc: [
          "'self'",
          'https://www.worldcubeassociation.org',
          'https://live.worldcubeassociation.org',
        ],
        manifestSrc: ["'self'"],
        frameSrc: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  }),
);

// WCA's /oauth/token has no CORS headers, so the browser cannot call it directly. The
// client_secret is appended here and the request forwarded.
app.post('/wca-token', express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const params = new URLSearchParams(req.body);
    if (WCA_CLIENT_SECRET) params.set('client_secret', WCA_CLIENT_SECRET);

    const wcaRes = await fetch('https://www.worldcubeassociation.org/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    const body = await wcaRes.text();
    res.status(wcaRes.status).type('application/json').send(body);
  } catch {
    res.status(502).json({ error: 'Token exchange failed' });
  }
});

// Anonymous usage events (src/lib/analytics.ts). Nothing is stored: App Engine forwards
// stdout to Cloud Logging, and a sink carries `component: "analytics"` into BigQuery.
//
// ponytail: unauthenticated, guarded only by the body-size cap and the sanitiser. If it
// ever gets spammed, add an App Engine dispatch rate limit or a build-time shared secret.
app.post(
  '/api/event',
  express.json({ limit: '2kb' }),
  (req, res) => {
    const event = sanitizeEvent(req.body);
    // Fields last: a sender must not be able to spoof the sink's filter or the severity.
    if (event)
      console.log(JSON.stringify({ ...event, component: 'analytics', severity: 'INFO' }));
    // Always 204, valid or not - a prober learns nothing, and the app ignores the reply.
    res.status(204).end();
  },
);

// Express would otherwise answer 413/400 with a stack trace, leaking the endpoint shape and
// filling Cloud Logging with error-severity noise. It routes errors only to a four-argument
// handler mounted on the app, never to one inside the route's own stack.
// eslint-disable-next-line no-unused-vars
app.use('/api/event', (err, req, res, next) => {
  res.status(204).end();
});

// Hashed assets are content-addressed - safe to cache for 1 year.
app.use(
  '/assets',
  express.static(path.join(DIST_DIR, 'assets'), {
    immutable: true,
    maxAge: '1y',
    index: false,
  }),
);

app.use(express.static(DIST_DIR, { maxAge: 0, index: false }));

// Unknown file extensions → 404 (don't fall through to SPA handler).
app.use((req, res, next) => {
  if (path.extname(req.path)) {
    res.status(404).type('text/plain; charset=utf-8').send('Not found');
    return;
  }
  next();
});

app.use((req, res) => {
  fs.readFile(INDEX_PATH, 'utf8', (err, html) => {
    if (err) {
      res
        .status(500)
        .type('text/plain; charset=utf-8')
        .send('Missing dist/index.html - run npm run build first.');
      return;
    }
    res
      .status(200)
      .type('text/html; charset=utf-8')
      .set('Cache-Control', 'no-store')
      .send(html);
  });
});

export { app };

// Only bind a port when started directly; an import gets the configured app unbound.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = app.listen(PORT, () => {
    console.log(`Scorecard server listening on port ${PORT}`);
  });

  process.on('SIGTERM', () =>
    server.close(() => console.log('Process terminated')),
  );
}
