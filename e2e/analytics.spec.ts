import { test, expect, download } from './fixtures';
import { organizer, realWcif } from './fakeWca';
import { sanitizeEvent } from '../analytics.js';

test('usage events survive the server sanitiser untouched and carry nobody\'s name', async ({ page, wca, loginAs }) => {
  const sent: unknown[] = [];
  page.on('request', (r) => { if (r.url().endsWith('/api/event')) sent.push(JSON.parse(r.postData() ?? 'null')); });

  const wcif = wca.add(realWcif('PickeringBlindfolded2026'));
  await loginAs();
  await page.getByText('Pickering Blindfolded 2026').click();
  await page.getByRole('button', { name: 'Continue →' }).click();
  await page.getByRole('button', { name: 'Generate →' }).click();
  await download(page, 'Download');
  await expect.poll(() => sent.length).toBeGreaterThanOrEqual(2);

  for (const event of sent) expect(sanitizeEvent(event)).toEqual(event);
  const all = JSON.stringify(sent);
  for (const secret of [organizer.name, organizer.email, organizer.wca_id, ...wcif.persons.map((p) => p.name)])
    expect(all).not.toContain(secret);
});
