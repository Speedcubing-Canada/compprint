import { describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import i18n from '../i18n/index';
import { readSettings } from '../lib/flowState';
import { sampleWcif } from '../test/fixtures';
import { addCompetition, backend, on } from '../test/fakeWca';
import { SAMPLE, click, walkToSettings } from '../test/journeys';
import { currentPath, renderApp } from '../test/renderApp';
import { LIVE_LOOKUP_WAIT_MS } from './SettingsPage';

async function atSettings() {
  addCompetition(sampleWcif());
  renderApp('/competitions');
  await walkToSettings();
}

async function uploadLogo(name: string, bytes: Uint8Array<ArrayBuffer>) {
  const input = document.querySelector<HTMLInputElement>('input[type="file"][accept="image/*"]')!;
  fireEvent.change(input, { target: { files: [new File([bytes], name, { type: name.endsWith('.png') ? 'image/png' : 'image/jpeg' })] } });
  await waitFor(() => expect(screen.getByText(name)).toBeTruthy());
}

describe('a logo too big for sessionStorage', () => {
  // The logo rides in competition_settings as a data URL, and a phone photo blows the ~5 MB
  // sessionStorage quota.
  it('tells the organizer instead of silently staying put', async () => {
    await atSettings();
    await uploadLogo('photo.jpg', new Uint8Array(4_500_000));

    await click(i18n.t('settings.generate_button'));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(currentPath()).toBe('/settings');
    expect(readSettings()?.logoDataUrl ?? null).toBeNull();
  });

  it('drops the warning once the organizer removes the logo', async () => {
    await atSettings();
    await uploadLogo('photo.jpg', new Uint8Array(4_500_000));
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
    await uploadLogo('club-logo.png', new Uint8Array([137, 80, 78, 71]));
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

// The live-results controls only show when name tags print.
async function atSettingsWithNametags() {
  addCompetition(sampleWcif());
  renderApp('/competitions');
  await screen.findByText(SAMPLE.name);
  await walkToSettings(async () => {
    const nametags = (await screen.findByText(i18n.t('scope.doc_nametags'))).closest('label')!.querySelector('input')!;
    if (!nametags.checked) fireEvent.click(nametags);
  });
}

type Req = { body: string };
// The person-id query is the only WCA Live call with variables.
const isPersonQuery = (req: Req) => Boolean((JSON.parse(req.body) as { variables?: unknown }).variables);

/** Holds `route`, or only its requests that match `when`, until the returned function is called. */
function hold(route: string, when: (req: Req) => boolean = () => true) {
  let release!: () => void;
  const held = new Promise<void>((r) => { release = r; });
  on(route, async (req, next) => { if (when(req)) await held; return next(); });
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
    // Only the person-id query, so the OTS default and the live id land before the click.
    const release = hold('POST live.worldcubeassociation.org/api', isPersonQuery);

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
    await act(() => vi.advanceTimersByTimeAsync(LIVE_LOOKUP_WAIT_MS));
    vi.useRealTimers();

    await waitFor(() => expect(currentPath()).toBe('/generate'));
    expect(readSettings()?.wcaLivePersonIds ?? null).toBeNull();
  });

  it('still saves the live id found during the wait', async () => {
    backend.liveIds.set(SAMPLE.id, '4242');
    let releaseId!: () => void;
    const idHeld = new Promise<void>((r) => { releaseId = r; });
    // The id answers after the click; the person-id query never does.
    on('POST live.worldcubeassociation.org/api', async (req, next) => {
      if (isPersonQuery(req)) return new Promise(() => {});
      await idHeld;
      return next();
    });

    await atSettings();
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    fireEvent.click(screen.getByRole('button', { name: i18n.t('settings.generate_button') }));
    releaseId();
    await act(() => vi.advanceTimersByTimeAsync(LIVE_LOOKUP_WAIT_MS));
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
    await act(() => new Promise((r) => setTimeout(r, 50)));

    await click(i18n.t('settings.generate_button'));

    await waitFor(() => expect(currentPath()).toBe('/generate'));
    expect(readSettings()).toMatchObject({ wcaLiveId: '7777', wcaLivePersonIds: null });
  });

  it('drops the person ids once the lookup has filled them', async () => {
    backend.liveIds.set(SAMPLE.id, '4242');
    backend.livePeople.set('4242', [{ id: '901', registrantId: 1 }]);
    await atSettingsWithNametags();
    const field = document.querySelector<HTMLInputElement>('#wca-live-id')!;
    await waitFor(() => expect(field.value).toBe('4242'));
    await act(() => new Promise((r) => setTimeout(r, 50)));
    fireEvent.change(field, { target: { value: '7777' } });

    await click(i18n.t('settings.generate_button'));

    await waitFor(() => expect(currentPath()).toBe('/generate'));
    expect(readSettings()).toMatchObject({ wcaLiveId: '7777', wcaLivePersonIds: null });
  });

  it('gets the person ids back when the found id is typed again', async () => {
    backend.liveIds.set(SAMPLE.id, '4242');
    backend.livePeople.set('4242', [{ id: '901', registrantId: 1 }]);
    await atSettingsWithNametags();
    const field = document.querySelector<HTMLInputElement>('#wca-live-id')!;
    await waitFor(() => expect(field.value).toBe('4242'));
    await act(() => new Promise((r) => setTimeout(r, 50)));
    fireEvent.change(field, { target: { value: '424' } });
    fireEvent.change(field, { target: { value: '4242' } });

    await click(i18n.t('settings.generate_button'));

    await waitFor(() => expect(currentPath()).toBe('/generate'));
    expect(readSettings()).toMatchObject({ wcaLiveId: '4242', wcaLivePersonIds: { 1: '901' } });
  });
});

describe('a failed person-id lookup', () => {
  it('keeps the ids an earlier run saved', async () => {
    backend.liveIds.set(SAMPLE.id, '4242');
    backend.livePeople.set('4242', [{ id: '901', registrantId: 1 }]);
    await atSettingsWithNametags();
    await waitFor(() => expect(document.querySelector<HTMLInputElement>('#wca-live-id')!.value).toBe('4242'));
    await act(() => new Promise((r) => setTimeout(r, 50)));
    await click(i18n.t('settings.generate_button'));
    await waitFor(() => expect(currentPath()).toBe('/generate'));

    on('POST live.worldcubeassociation.org/api', (req, next) => (isPersonQuery(req) ? new Response('', { status: 500 }) : next()));
    await click(i18n.t('common.back'));
    await screen.findByRole('button', { name: i18n.t('settings.generate_button') });
    await act(() => new Promise((r) => setTimeout(r, 50)));
    await click(i18n.t('settings.generate_button'));

    await waitFor(() => expect(currentPath()).toBe('/generate'));
    expect(readSettings()).toMatchObject({ wcaLiveId: '4242', wcaLivePersonIds: { 1: '901' } });
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
