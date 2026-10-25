// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, useTheme } from './ThemeContext';
import { THEME_STORAGE_KEY } from './theme';

// A matchMedia whose dark-mode answer the test can flip, firing the listeners like the OS does.
function osTheme(dark: boolean) {
  const listeners = new Set<(e: MediaQueryListEvent) => void>();
  vi.stubGlobal('matchMedia', (media: string) => ({
    media, get matches() { return dark; },
    addEventListener: (_: string, fn: (e: MediaQueryListEvent) => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: (e: MediaQueryListEvent) => void) => listeners.delete(fn),
  }));
  return (next: boolean) => act(() => {
    dark = next;
    for (const fn of listeners) fn({ matches: next } as MediaQueryListEvent);
  });
}

function Probe() {
  const { theme, toggleTheme } = useTheme();
  return <button onClick={toggleTheme}>{theme}</button>;
}

const mount = () => render(<ThemeProvider><Probe /></ThemeProvider>);
const theme = () => document.documentElement.getAttribute('data-theme');

beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('ThemeProvider', () => {
  it('follows the OS while the organizer has not chosen', () => {
    const setOs = osTheme(false);
    mount();
    expect(theme()).toBe('light');
    setOs(true);
    expect(theme()).toBe('dark');
  });

  it('keeps an explicit choice when the OS changes afterwards', () => {
    const setOs = osTheme(false);
    mount();
    fireEvent.click(screen.getByRole('button'));
    expect(theme()).toBe('dark');
    setOs(false);
    setOs(true);
    setOs(false);
    expect(theme()).toBe('dark');
  });

  it('starts from a stored choice over the OS, and ignores the OS from then on', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    const setOs = osTheme(true);
    mount();
    expect(theme()).toBe('light');
    setOs(true);
    expect(theme()).toBe('light');
  });

  it('still toggles when storage throws (private mode)', () => {
    osTheme(false);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    mount();
    fireEvent.click(screen.getByRole('button'));
    expect(theme()).toBe('dark');
  });

  it('refuses to run outside a provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/within a ThemeProvider/);
  });
});
