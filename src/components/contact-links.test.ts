import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { REPO_URL, SUPPORT_EMAIL } from './ContactLinks';

/**
 * The public-release contact affordances. Two things here are easy to break silently:
 *
 *  - the GitHub mark is a `public/` asset rather than a lucide icon (lucide 1.x dropped
 *    brand icons, and design-system.test.ts forbids inline <svg> in components). Delete or
 *    rename the file and the header just renders a broken-image box - nothing throws.
 *  - the repo URL and support address are exported constants so there is exactly one copy.
 *    A second hardcoded address elsewhere is how one of them goes stale.
 */

const mark = readFileSync(
  fileURLToPath(new URL('../../public/github-mark.svg', import.meta.url)),
  'utf-8',
);

function componentSources(): { name: string; source: string }[] {
  const dirUrl = new URL('./', import.meta.url);
  return readdirSync(dirUrl)
    .filter(f => f.endsWith('.tsx'))
    .map(name => ({
      name,
      source: readFileSync(fileURLToPath(new URL(name, dirUrl)), 'utf-8'),
    }));
}

describe('contact links', () => {
  it('points at the real repo and the software team', () => {
    expect(REPO_URL).toBe('https://github.com/Speedcubing-Canada/compprint');
    expect(SUPPORT_EMAIL).toBe('software@speedcubingcanada.org');
  });

  it('ships the GitHub mark the header renders', () => {
    expect(mark).toContain('<svg');
    expect(mark).toContain('viewBox');
  });

  it('references the mark by the path it is served from', () => {
    const contactLinks = componentSources().find(f => f.name === 'ContactLinks.tsx');
    expect(contactLinks?.source).toContain('src="/github-mark.svg"');
  });

  it('declares the address and URL in exactly one component', () => {
    const files = componentSources();
    expect(files.filter(f => f.source.includes(SUPPORT_EMAIL)).map(f => f.name))
      .toEqual(['ContactLinks.tsx']);
    expect(files.filter(f => f.source.includes(REPO_URL)).map(f => f.name))
      .toEqual(['ContactLinks.tsx']);
  });
});
