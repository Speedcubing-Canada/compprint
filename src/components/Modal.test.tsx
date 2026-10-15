// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { renderWithProviders, stubMatchMedia, useEnglish } from '../test/render';
import { markAllSeen } from '../changelog';
import AboutDialog from './AboutDialog';
import WhatsNewDialog from './WhatsNewDialog';
import i18n from '../i18n/index';
import { APP_NAME } from '../brand';

/**
 * The dialogs used to be a plain <div> overlay: no focus trap, no focus restore, no
 * accessible name, and the page still scrolled behind them. They are native <dialog>
 * elements opened with showModal() now, which is what supplies all of that. These tests
 * pin the parts that are ours - that it IS a dialog element, that it is named by its
 * heading, and that closing it reports back - because the browser behaviour we rely on
 * only exists if we keep using the native element.
 */

// This project does not enable testing-library's auto-cleanup, so renders would otherwise
// pile up in the DOM and `document.querySelector('dialog')` would find an earlier one.
beforeEach(async () => {
  cleanup();
  localStorage.clear();
  markAllSeen();
  stubMatchMedia();
  await useEnglish();
});

const dialog = () => document.querySelector('dialog')!;

describe('AboutDialog', () => {
  it('opens a native dialog named by its heading', () => {
    renderWithProviders(<AboutDialog />);
    expect(dialog().open).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: i18n.t('about.trigger') }));

    expect(dialog().open).toBe(true);
    const labelledBy = dialog().getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy!)?.textContent).toBe(i18n.t('about.title', { name: APP_NAME }));
  });

  // aria-modal must not be hand-set on a showModal() dialog: the browser owns it, and a
  // stale attribute is worse than none.
  it('leaves aria-modal to the browser', () => {
    renderWithProviders(<AboutDialog />);
    expect(dialog().hasAttribute('aria-modal')).toBe(false);
  });

  it('closes on the close button', () => {
    renderWithProviders(<AboutDialog />);
    fireEvent.click(screen.getByRole('button', { name: i18n.t('about.trigger') }));
    fireEvent.click(screen.getByRole('button', { name: i18n.t('about.close') }));
    expect(dialog().open).toBe(false);
  });

  // Escape and a backdrop click both reach us as the dialog's `close` event, so the
  // component state has to follow it rather than only its own button.
  it('follows the dialog\'s own close event', () => {
    renderWithProviders(<AboutDialog />);
    fireEvent.click(screen.getByRole('button', { name: i18n.t('about.trigger') }));

    // Escape reaches React through its own event system in a browser; called straight from
    // a test it needs act(), or the state update never commits and the two desync.
    act(() => dialog().close());

    expect(dialog().open).toBe(false);
    // Re-openable: the state tracked the close instead of going stale at `open = true`.
    fireEvent.click(screen.getByRole('button', { name: i18n.t('about.trigger') }));
    expect(dialog().open).toBe(true);
  });
});

describe('WhatsNewDialog', () => {
  it('opens by itself when there are unseen entries', () => {
    localStorage.clear();
    renderWithProviders(<WhatsNewDialog />);
    expect(dialog().open).toBe(true);
  });

  it('stays shut once everything is seen', () => {
    markAllSeen();
    renderWithProviders(<WhatsNewDialog />);
    expect(dialog().open).toBe(false);
  });

  it('marks everything seen when the dialog closes itself', () => {
    localStorage.clear();
    renderWithProviders(<WhatsNewDialog />);

    act(() => dialog().close());

    // Escape must count as "read", or the dialog reopens on the next page.
    cleanup();
    renderWithProviders(<WhatsNewDialog />);
    expect(dialog().open).toBe(false);
  });
});
