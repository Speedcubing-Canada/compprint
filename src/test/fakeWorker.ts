// jsdom has no Worker and vitest cannot load a `new URL(..., import.meta.url)` module worker, so
// this runs the real runJobs on the main thread and relays its messages the way a Worker would.
// Pair it with a mocked `pdf()` (see routeSetup.ts): real PDF bytes are the pdf project's job.

import { runJobs, type WorkerRequest, type WorkerResponse } from '../pdf/renderBundle';

export const workers = {
  /** Rejections runJobs let escape. A real worker drops these, so the page never hears of them. */
  unhandled: [] as unknown[],
  /** Set to make the next worker fire `error` instead of running, like a failed module load. */
  failToLoad: null as string | null,
};

export function resetWorkers() {
  workers.unhandled.length = 0;
  workers.failToLoad = null;
}

export class FakeWorker {
  onmessage: ((e: MessageEvent<WorkerResponse>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  terminated = false;

  postMessage(req: WorkerRequest) {
    // Structured clone, as postMessage does: the page must not rely on sharing objects.
    const copy = structuredClone(req);
    const failure = workers.failToLoad;
    queueMicrotask(() => {
      if (failure) {
        this.onerror?.(new ErrorEvent('error', { message: failure }));
        return;
      }
      runJobs(copy, (msg) => {
        if (!this.terminated) this.onmessage?.(new MessageEvent('message', { data: msg }));
      }).catch((e: unknown) => workers.unhandled.push(e));
    });
  }

  terminate() { this.terminated = true; }
}
