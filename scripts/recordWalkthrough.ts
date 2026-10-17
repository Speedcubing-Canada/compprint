// Records docs/readme/walkthrough.gif: the real app in dark mode with the WCA API mocked.
//
//   npm run record:walkthrough            # writes the GIF
//   npm run record:walkthrough -- --shots # one PNG per step into walkthrough-shots/, no GIF
//
// Needs ffmpeg on PATH. Run through vite-node so the TS fixtures import directly.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';
import { createServer } from 'vite';
import { sampleWcif } from '../src/test/fixtures';
import { CHANGELOG } from '../src/changelog';
import { THEME_STORAGE_KEY } from '../src/theme/theme';

const SIZE = { width: 1280, height: 800 };
const GIF_WIDTH = 800;
const FPS = 10;
const OUT = 'docs/readme/walkthrough.gif';
const shots = process.argv.includes('--shots');

const comp = (id: string, name: string, city: string, date: string) => ({
  id, name, city, country_iso2: 'CA', start_date: date, end_date: date,
  announced_at: '2026-01-01', registration_open: '2026-01-01', registration_close: '2026-02-01',
  competitor_limit: null, website: '',
});
const competitions = [
  comp('GrosJouetsaMontreal2026', 'Gros Jouets à Montréal 2026', 'Montréal, Québec', '2999-11-14'),
  comp('OttawaWinterOpen2026', 'Ottawa Winter Open 2026', 'Ottawa, Ontario', '2999-12-05'),
  comp('VancouverSpring2027', 'Vancouver Spring 2027', 'Vancouver, British Columbia', '2999-03-20'),
];

async function mockApis(page: Page) {
  const json = (body: unknown) => ({ contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('https://www.worldcubeassociation.org/api/v0/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/competitions')) return route.fulfill(json(competitions));
    if (url.pathname.includes('/wcif/')) return route.fulfill(json(sampleWcif()));
    return route.fulfill(json({ scoretaking_software: 'wca_live', on_the_spot_registration: false }));
  });
  await page.route('https://live.worldcubeassociation.org/**', route => route.fulfill(json({ data: {} })));
  await page.route('**/api/event', route => route.fulfill({ status: 204 }));
}

async function main() {
  const server = await createServer({ server: { port: 5199, strictPort: true }, logLevel: 'error' });
  await server.listen();
  const videoDir = mkdtempSync(join(tmpdir(), 'walkthrough-'));
  const shotDir = 'walkthrough-shots';
  if (shots) mkdirSync(shotDir, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: SIZE, colorScheme: 'dark', locale: 'en-US',
    ...(shots ? {} : { recordVideo: { dir: videoDir, size: SIZE } }),
  });
  const now = Math.floor(Date.now() / 1000);
  await context.addInitScript(([token, user, seenKey, seenId, themeKey]) => {
    sessionStorage.setItem('wca_token', token);
    sessionStorage.setItem('wca_user', user);
    localStorage.setItem(seenKey, seenId);
    localStorage.setItem(themeKey, 'dark');
  }, [
    JSON.stringify({ access_token: 'x', token_type: 'Bearer', expires_in: 7200, scope: 'public', created_at: now, refresh_token: 'x' }),
    JSON.stringify({ id: 1, name: 'Ada Lovelace', wca_id: '2018LOVE01', avatar: { thumb_url: '' }, email: '' }),
    'changelog_seen', CHANGELOG[0].id, THEME_STORAGE_KEY,
  ]);

  const page = await context.newPage();
  const videoStart = Date.now();
  await mockApis(page);
  let step = 0;
  const pause = async (ms: number) => {
    if (!shots) return page.waitForTimeout(ms);
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(shotDir, `${String(++step).padStart(2, '0')}.png`) });
  };
  const click = async (name: string | RegExp, role: 'button' | 'radio' | 'checkbox' = 'button') => {
    await page.getByRole(role, { name }).first().click();
  };

  await page.goto('http://localhost:5199/competitions');
  await page.getByText('Gros Jouets à Montréal 2026').waitFor();
  // Cut the blank frames before the first paint.
  const trim = (Date.now() - videoStart) / 1000;
  await pause(1500);
  await page.getByText('Gros Jouets à Montréal 2026').click();
  await page.getByRole('heading', { name: 'What to generate' }).waitFor();
  await pause(1500);
  await click(/Everything/, 'radio');
  await pause(400);
  await click(/Nametags/, 'checkbox');
  await pause(400);
  await click(/Group Overview/, 'checkbox');
  await pause(1000);
  await click(/Continue/);
  await page.getByRole('heading', { name: 'Configure your print settings' }).waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));
  await pause(1200);
  // The second "Français" tile is the second-language row.
  await page.getByRole('button', { name: /Français/ }).nth(1).click();
  await pause(1500);
  await click(/Generate/);
  await page.getByRole('button', { name: /Download/ }).waitFor({ timeout: 60_000 });
  await pause(2500);
  await page.mouse.wheel(0, 500);
  await pause(2000);

  const video = page.video();
  await context.close();
  await browser.close();
  await server.close();
  if (shots) return;

  const webm = await video!.path();
  const vf = `fps=${FPS},scale=${GIF_WIDTH}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`;
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(trim), '-i', webm, '-vf', vf, OUT], { stdio: 'inherit' });
  rmSync(videoDir, { recursive: true, force: true });
  console.log(`wrote ${OUT}`);
}

main().catch(e => { console.error(e); process.exit(1); });
