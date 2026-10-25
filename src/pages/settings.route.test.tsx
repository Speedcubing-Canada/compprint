import { describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import i18n from '../i18n/index';
import { readSettings } from '../lib/flowState';
import { sampleWcif } from '../test/fixtures';
import { addCompetition, backend, on } from '../test/fakeWca';
import { SAMPLE, click, walkToSettings } from '../test/journeys';
import { currentPath, renderApp } from '../test/renderApp';

async function atSettings() {
  addCompetition(sampleWcif());
  renderApp('/competitions');
  await walkToSettings();
}

function upload(input: HTMLInputElement, file: File) {
  fireEvent.change(input, { target: { files: [file] } });
}

describe('a logo too big for sessionStorage', () => {
  // The logo rides in competition_settings as a data URL, and a phone photo blows the ~5 MB
  // sessionStorage quota.
  it('tells the organizer instead of silently staying put', async () => {
    await atSettings();
    const input = document.querySelector<HTMLInputElement>('input[type="file"][accept="image/*"]')!;
    upload(input, new File([new Uint8Array(4_500_000)], 'photo.jpg', { type: 'image/jpeg' }));
    await waitFor(() => expect(screen.getByText('photo.jpg')).toBeTruthy());

    await click(i18n.t('settings.generate_button'));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(currentPath()).toBe('/settings');
    expect(readSettings()?.logoDataUrl ?? null).toBeNull();
  });

  it('drops the warning once the organizer removes the logo', async () => {
    await atSettings();
    const input = document.querySelector<HTMLInputElement>('input[type="file"][accept="image/*"]')!;
    upload(input, new File([new Uint8Array(4_500_000)], 'photo.jpg', { type: 'image/jpeg' }));
    await waitFor(() => expect(screen.getByText('photo.jpg')).toBeTruthy());
    await click(i18n.t('settings.generate_button'));
    await screen.findByRole('alert');

    await click(i18n.t('common.remove'));

    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('drops the warning on a double-check edit too', async () => {
    await atSettings();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    await click(i18n.t('settings.generate_button'));
    await screen.findByRole('alert');

    await click(i18n.t('settings.advanced.toggle'));
    fireEvent.click(screen.getByLabelText(i18n.t('settings.double_check.round_first')));

    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('starting a custom competition after a WCA one', () => {
  // /settings restores the last saved blob, so the custom card must clear it.
  it('starts from clean settings, not the WCA competition\'s', async () => {
    await atSettings();
    const input = document.querySelector<HTMLInputElement>('input[type="file"][accept="image/*"]')!;
    upload(input, new File([new Uint8Array([137, 80, 78, 71])], 'club-logo.png', { type: 'image/png' }));
    await waitFor(() => expect(screen.getByText('club-logo.png')).toBeTruthy());
    await click(i18n.t('settings.generate_button'));
    await waitFor(() => expect(currentPath()).toBe('/generate'));
    expect(readSettings()?.logoDataUrl).toMatch(/^data:image\/png/);

    cleanup();
    renderApp('/competitions');
    await click(new RegExp(i18n.t('picker.create_custom_title')));
    fireEvent.change(await screen.findByPlaceholderText(i18n.t('custom.name_placeholder')), { target: { value: 'Club Meetup' } });
    await click(i18n.t('settings.advanced.add_custom_event'));
    fireEvent.change(screen.getByPlaceholderText(i18n.t('settings.advanced.event_name_placeholder')), { target: { value: 'Relay' } });
    await click(i18n.t('custom.continue'));
    await screen.findByRole('button', { name: i18n.t('settings.generate_button') });

    expect(screen.queryByText('club-logo.png')).toBeNull();
    await click(i18n.t('settings.generate_button'));
    await waitFor(() => expect(currentPath()).toBe('/generate'));
    expect(readSettings()?.logoDataUrl).toBeNull();
  });
});

/** Holds `route` until the returned function is called. */
// The live-results controls only show when name tags print.
async function atSettingsWithNametags() {
  addCompetition(sampleWcif());
  renderApp('/competitions');
  fireEvent.click(await screen.findByText(SAMPLE.name));
  const nametags = (await screen.findByText(i18n.t('scope.doc_nametags'))).closest('label')!.querySelector('input')!;
  if (!nametags.checked) fireEvent.click(nametags);
  await click(i18n.t('scope.continue'));
  await screen.findByRole('button', { name: i18n.t('settings.generate_button') });
}

function hold(route: string) {
  let release!: () => void;
  const held = new Promise<void>((r) => { release = r; });
  on(route, async (_req, next) => { await held; return next(); });
  return release;
}

describe('generating before the WCA Live lookup finishes', () => {
  // The person-id map arrives a few requests after the page opens; without it every name tag
  // QR falls back to the WCA Live home page.
  it('waits for the whole lookup instead of saving without the ids', async () => {
    backend.liveIds.set(SAMPLE.id, '4242');
    backend.livePeople.set('4242', [{ id: '901', registrantId: 1 }]);
    // The first WCA Live call, so the submit lands before any of the chain resolved.
    const release = hold('POST live.worldcubeassociation.org/api');

    await atSettings();
    const generate = screen.getByRole('button', { name: i18n.t('settings.generate_button') });
    fireEvent.click(generate);
    expect((generate as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(generate);
    release();

    await waitFor(() => expect(currentPath()).toBe('/generate'));
    // Without the id the QR goes to the home page whatever the map holds.
    expect(readSettings()).toMatchObject({ wcaLiveId: '4242', wcaLivePersonIds: { 1: '901' } });
  });

  it('saves the switch to ILR the lookup makes', async () => {
    backend.info.set(SAMPLE.id, { scoretaking_software: 'internal' });
    const release = hold(`GET www.worldcubeassociation.org/api/v0/competitions/${SAMPLE.id}`);

    await atSettings();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('settings.generate_button') }));
    release();

    await waitFor(() => expect(currentPath()).toBe('/generate'));
    expect(readSettings()?.liveResultsMode).toBe('ilr');
  });

  it('keeps a live-results choice made before the lookup answered', async () => {
    backend.info.set(SAMPLE.id, { scoretaking_software: 'internal' });
    const release = hold(`GET www.worldcubeassociation.org/api/v0/competitions/${SAMPLE.id}`);
    await atSettingsWithNametags();
    const live = document.querySelector<HTMLInputElement>('input[name="liveResultsMode"][value="wca-live"]')!;
    fireEvent.click(document.querySelector<HTMLInputElement>('input[name="liveResultsMode"][value="ilr"]')!);
    fireEvent.click(live);

    await click(i18n.t('settings.generate_button'));
    release();

    await waitFor(() => expect(currentPath()).toBe('/generate'));
    expect(readSettings()?.liveResultsMode).toBe('wca-live');
  });

  it('stays put when the organizer goes back during the wait', async () => {
    backend.liveIds.set(SAMPLE.id, '4242');
    const release = hold('POST live.worldcubeassociation.org/api');
    await atSettings();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('settings.generate_button') }));
    await click(i18n.t('common.back'));
    await waitFor(() => expect(currentPath()).toBe('/scope'));

    release();
    await act(() => new Promise((r) => setTimeout(r, 50)));

    expect(currentPath()).toBe('/scope');
    expect(readSettings()).toBeNull();
  });
});

describe('an edit made while the WCA Live lookup is still running', () => {
  it('is saved as the organizer left it, with the ids the lookup adds after the click', async () => {
    backend.info.set(SAMPLE.id, { on_the_spot_registration: true });
    backend.liveIds.set(SAMPLE.id, '4242');
    backend.livePeople.set('4242', [{ id: '901', registrantId: 1 }]);
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    // Only the person-id query, so the OTS default and the live id land before the click.
    on('POST live.worldcubeassociation.org/api', async (req, next) => {
      if ((JSON.parse(req.body) as { variables?: unknown }).variables) await held;
      return next();
    });

    await atSettings();
    const ots = screen.getByText(i18n.t('settings.ots.label')).closest('label')!.querySelector('input')!;
    await waitFor(() => expect(ots.checked).toBe(true));
    fireEvent.click(ots);
    await click(i18n.t('settings.generate_button'));
    release();

    await waitFor(() => expect(currentPath()).toBe('/generate'));
    expect(readSettings()).toMatchObject({ otsBlanks: false, wcaLiveId: '4242', wcaLivePersonIds: { 1: '901' } });
  });
});

describe('a WCA Live that never answers', () => {
  it('holds Generate for a few seconds, not forever', async () => {
    backend.liveIds.set(SAMPLE.id, '4242');
    hold('POST live.worldcubeassociation.org/api');

    await atSettings();
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    fireEvent.click(screen.getByRole('button', { name: i18n.t('settings.generate_button') }));
    await act(() => vi.advanceTimersByTimeAsync(5000));
    vi.useRealTimers();

    await waitFor(() => expect(currentPath()).toBe('/generate'));
    expect(readSettings()?.wcaLivePersonIds ?? null).toBeNull();
  });

  it('still saves the live id found during the wait', async () => {
    backend.liveIds.set(SAMPLE.id, '4242');
    let releaseId!: () => void;
    const idHeld = new Promise<void>((r) => { releaseId = r; });
    // The id answers after the click; the person-id query, the only one with variables, never does.
    on('POST live.worldcubeassociation.org/api', async (req, next) => {
      if ((JSON.parse(req.body) as { variables?: unknown }).variables) return new Promise(() => {});
      await idHeld;
      return next();
    });

    await atSettings();
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    fireEvent.click(screen.getByRole('button', { name: i18n.t('settings.generate_button') }));
    releaseId();
    await act(() => vi.advanceTimersByTimeAsync(5000));
    vi.useRealTimers();

    await waitFor(() => expect(currentPath()).toBe('/generate'));
    expect(readSettings()).toMatchObject({ wcaLiveId: '4242', wcaLivePersonIds: null });
  });
});

describe('a WCA Live id typed over the found one', () => {
  it('is saved without the found competition\'s person ids', async () => {
    backend.liveIds.set(SAMPLE.id, '4242');
    backend.livePeople.set('4242', [{ id: '901', registrantId: 1 }]);
    const release = hold('POST live.worldcubeassociation.org/api');
    await atSettingsWithNametags();
    const field = document.querySelector<HTMLInputElement>('#wca-live-id')!;
    fireEvent.change(field, { target: { value: '7777' } });
    release();
    await waitFor(() => expect(screen.getByRole('button', { name: i18n.t('settings.generate_button') })).toBeTruthy());
    await act(() => new Promise((r) => setTimeout(r, 50)));

    await click(i18n.t('settings.generate_button'));

    await waitFor(() => expect(currentPath()).toBe('/generate'));
    expect(readSettings()).toMatchObject({ wcaLiveId: '7777', wcaLivePersonIds: null });
  });
});

describe('storage that refuses the save for another reason', () => {
  it('says so instead of doing nothing', async () => {
    await atSettings();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    await click(i18n.t('settings.generate_button'));
    expect((await screen.findByRole('alert')).textContent).toBe(i18n.t('settings.save_failed'));
    expect(currentPath()).toBe('/settings');
  });
});
