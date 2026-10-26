import { test as base, expect, type Download, type Page } from '@playwright/test';
import { unzipSync } from 'fflate';
import { PDFDocument } from 'pdf-lib';
import { CHANGELOG } from '../src/changelog';
import { FakeWca } from './fakeWca';

export { expect };

type Fixtures = {
  wca: FakeWca;
  /** Console errors a test expects, such as the 401 it provokes. Anything else fails the test. */
  allowConsole: RegExp[];
  loginAs: (page?: Page) => Promise<void>;
};

export const test = base.extend<Fixtures>({
  allowConsole: [[], { option: true }],

  wca: async ({ page }, use) => {
    const wca = new FakeWca();
    await wca.install(page);
    // A UI preference, not auth: keeps the What's New dialog from covering the first page.
    await page.addInitScript((id) => localStorage.setItem('changelog_seen', id), CHANGELOG[0]!.id);
    await use(wca);
  },

  // Auto: every test fails on a console error or a CSP violation, which Chromium logs as one.
  page: async ({ page, allowConsole }, use) => {
    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));
    await use(page);
    expect(errors.filter((e) => !allowConsole.some((re) => re.test(e)))).toEqual([]);
  },

  loginAs: async ({ page, wca }, use) => {
    await use(async (p = page) => {
      void wca;
      await p.goto('/');
      await p.getByRole('button', { name: 'Sign in with WCA' }).click();
      await p.waitForURL('**/competitions');
    });
  },
});

/** Clicks the button and returns the file it downloads, unzipped: filename → bytes. */
export async function download(page: Page, button: string | RegExp): Promise<{ name: string; files: Record<string, Uint8Array> }> {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: button }).click()]);
  const bytes = await read(dl);
  const name = dl.suggestedFilename();
  return { name, files: name.endsWith('.zip') ? unzipSync(bytes) : { [name]: bytes } };
}

async function read(dl: Download): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const c of await dl.createReadStream()) chunks.push(c as Buffer);
  return new Uint8Array(Buffer.concat(chunks));
}

export const pageCount = async (pdf: Uint8Array) => (await PDFDocument.load(pdf)).getPageCount();
