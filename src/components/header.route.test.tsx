import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import i18n from '../i18n/index';
import { stubMatchMedia } from '../test/render';
import { click } from '../test/journeys';
import { currentPath, renderApp } from '../test/renderApp';

const signIn = () => screen.findByRole('button', { name: i18n.t('login.sign_in_button') });

describe('signing out from the header', () => {
  it('on desktop, drops the session and lands on the login page', async () => {
    renderApp('/competitions');
    await click(i18n.t('common.sign_out'));
    await signIn();
    expect(currentPath()).toBe('/');
    expect(sessionStorage.getItem('wca_token')).toBeNull();
    expect(sessionStorage.getItem('wca_user')).toBeNull();
  });

  it('on a phone, through the menu', async () => {
    stubMatchMedia(true);
    renderApp('/competitions');
    const menu = await screen.findByRole('button', { name: i18n.t('common.menu') });
    expect(screen.queryByRole('button', { name: i18n.t('common.sign_out') })).toBeNull();
    fireEvent.click(menu);
    expect(menu.getAttribute('aria-expanded')).toBe('true');
    await click(i18n.t('common.sign_out'));
    await signIn();
    expect(sessionStorage.getItem('wca_token')).toBeNull();
  });
});

describe('the phone menu', () => {
  it('closes on a tap outside the header, and stays open on a tap inside it', async () => {
    stubMatchMedia(true);
    renderApp('/competitions');
    const menu = await screen.findByRole('button', { name: i18n.t('common.menu') });
    fireEvent.click(menu);
    fireEvent.mouseDown(menu.closest('header')!);
    expect(menu.getAttribute('aria-expanded')).toBe('true');
    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(menu.getAttribute('aria-expanded')).toBe('false'));
  });
});
