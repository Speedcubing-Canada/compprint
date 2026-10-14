import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Guards the UI design-system constraints so they can't silently regress:
 *  - styling lives in CSS modules, not inline `React.CSSProperties` objects,
 *  - the weight hierarchy is exactly 400 / 500 / 700 (no 600 or 800),
 *  - icons come from the lucide-react pack, not hand-rolled inline <svg> or emoji,
 *  - Montserrat is loaded with only those three weights.
 *
 * Scope is the on-screen UI (src/components + src/pages + src/styles). PDF documents
 * under src/pdf are intentionally excluded - they use @react-pdf primitives (incl. Svg)
 * and their own StyleSheet, and must not be constrained by these UI rules.
 */

const UI_DIRS = ['../components', '../pages', '../styles'] as const;

function uiSourceFiles(ext: '.tsx' | '.css'): { path: string; source: string }[] {
  const files: { path: string; source: string }[] = [];
  for (const dir of UI_DIRS) {
    const dirUrl = new URL(`${dir}/`, import.meta.url);
    let entries: string[];
    try {
      entries = readdirSync(dirUrl);
    } catch {
      continue; // a dir that doesn't exist yet is not a failure
    }
    for (const entry of entries) {
      if (!entry.endsWith(ext)) continue;
      if (entry.includes('.test.')) continue;
      const source = readFileSync(fileURLToPath(new URL(entry, dirUrl)), 'utf-8');
      files.push({ path: `${dir}/${entry}`, source });
    }
  }
  return files;
}

const TSX = uiSourceFiles('.tsx');
const CSS = [
  ...uiSourceFiles('.css'),
  { path: '../index.css', source: readFileSync(fileURLToPath(new URL('../index.css', import.meta.url)), 'utf-8') },
];

// The emoji icons that were replaced with lucide-react components.
const FORBIDDEN_EMOJI = ['⏳', '⚙️', '❌', '✓', '↑', '▾', '▸'];

describe('UI design system', () => {
  it('finds the UI source files to scan', () => {
    expect(TSX.length).toBeGreaterThan(5);
    expect(CSS.length).toBeGreaterThan(5);
  });

  /**
   * The app used to style every component with an inline `s` object, which made
   * :hover, :active and media queries unexpressible. Styling is CSS modules now;
   * a style object that comes back takes those away again.
   */
  it('has no inline CSSProperties style objects', () => {
    const offenders = TSX
      .filter(f => /Record<string, React\.CSSProperties>|:\s*React\.CSSProperties\s*=/.test(f.source))
      .map(f => f.path);
    expect(offenders).toEqual([]);
  });

  /**
   * Type sizes come from the scale, never from a number typed into one rule. The old
   * inline styles had 9px, 11px, 12px, 13px and 16px hardcoded past the tokens, which is
   * how the scale drifted into a section heading only one pixel above an option title.
   */
  it('takes every font size from a --fs-* token', () => {
    const offenders = CSS
      .flatMap(f => [...f.source.matchAll(/font-size:\s*([^;]+);/g)]
        .filter(m => !m[1].includes('var(--fs-'))
        .map(m => `${f.path}: font-size: ${m[1].trim()}`));
    expect(offenders).toEqual([]);
  });

  /**
   * A control hidden behind a custom tile (the preset picker) must stay in the
   * accessibility tree and stay focusable, so it is hidden with opacity, never with
   * display:none or visibility:hidden. Checked statically because vitest runs with CSS
   * processing off - a rendered assertion would pass either way.
   */
  it('keeps visually-hidden inputs focusable', () => {
    const offenders = CSS
      .flatMap(f => [...f.source.matchAll(/\.(\w*[Ii]nput)\s*\{([^}]*)\}/g)]
        .filter(m => /opacity:\s*0/.test(m[2]) && /display:\s*none|visibility:\s*hidden/.test(m[2]))
        .map(m => `${f.path}: .${m[1]}`));
    expect(offenders).toEqual([]);
  });

  it('uses only the 400/500/700 weight hierarchy (no 600 or 800)', () => {
    const offenders = [
      ...TSX.filter(f => /fontWeight: ?(600|800)/.test(f.source)),
      ...CSS.filter(f => /font-weight: ?(600|800)/.test(f.source)),
    ].map(f => f.path);
    expect(offenders).toEqual([]);
  });

  it('has no hand-rolled inline <svg> icons (use lucide-react instead)', () => {
    const offenders = TSX.filter(f => f.source.includes('<svg')).map(f => f.path);
    expect(offenders).toEqual([]);
  });

  it('has no emoji used as icons (use lucide-react instead)', () => {
    const offenders = TSX
      .filter(f => FORBIDDEN_EMOJI.some(e => f.source.includes(e)))
      .map(f => f.path);
    expect(offenders).toEqual([]);
  });

  it('self-hosts Montserrat with exactly the 400/500/700 weights', () => {
    const main = readFileSync(fileURLToPath(new URL('../main.tsx', import.meta.url)), 'utf-8');
    const weights = [...main.matchAll(/@fontsource\/montserrat\/(\d+)\.css/g)].map(m => m[1]);
    expect(weights).toEqual(['400', '500', '700']);
    // Google's CDN leaks every visitor's IP (GDPR).
    const html = readFileSync(fileURLToPath(new URL('../../index.html', import.meta.url)), 'utf-8');
    expect(html).not.toContain('fonts.googleapis.com');
  });
});
