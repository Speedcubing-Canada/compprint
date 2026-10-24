// Setup for the `routes` project (*.route.test.tsx): the fake WCA behind fetch, the in-thread
// worker, a captured download, and a clean slate after every test.

import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { resetBackend, stubWcaFetch } from './fakeWca';
import { FakeWorker, resetWorkers } from './fakeWorker';
import { stubMatchMedia, useEnglish } from './render';
import { markAllSeen } from '../changelog';
import { clearWcifCache } from '../lib/wcifCache';

vi.mock('@react-pdf/renderer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@react-pdf/renderer')>()),
  pdf: () => ({ toBlob: async () => new Blob(['%PDF-fake'], { type: 'application/pdf' }) }),
}));

export const downloads: { filename: string; blob: Blob }[] = [];
const blobs = new Map<string, Blob>();

beforeEach(async () => {
  stubWcaFetch();
  stubMatchMedia();
  vi.stubGlobal('Worker', FakeWorker);
  // jsdom's Blob has no stream(), which runJobs zips through.
  vi.stubGlobal('Blob', NodeBlob);
  // jsdom has neither, so assigning leaks nothing into the next file.
  URL.createObjectURL = (b: Blob) => { const u = `blob:test/${blobs.size}`; blobs.set(u, b); return u; };
  URL.revokeObjectURL = () => {};
  // The page downloads through a synthetic <a download> click, which jsdom would try to navigate.
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    const blob = blobs.get(this.href);
    if (blob && this.download) downloads.push({ filename: this.download, blob });
  });
  markAllSeen();
  await useEnglish();
});

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  localStorage.clear();
  resetBackend();
  resetWorkers();
  clearWcifCache();
  downloads.length = 0;
  blobs.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
