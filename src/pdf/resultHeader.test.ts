import { describe, expect, it } from 'vitest';
import { getStrings } from '../lib/i18n';
import type { LocaleCode } from '../types/settings';
import { resultHeader } from './resultHeader';

const card = (limit: string | null, more = {}) =>
  ({ eventId: '333', limit, isCumulative: false, ...more });
const LOCALES: LocaleCode[] = ['en', 'fr', 'es', 'pt'];

describe('resultHeader', () => {
  it('prints the limit', () => {
    expect(resultHeader(card('10:00'), getStrings('en'))).toContain('(DNF if not under 10:00)');
  });

  // A WCA blank card: the delegate writes the limit in.
  it('keeps the prompt when the limit is empty', () => {
    expect(resultHeader(card(''), getStrings('en'))).toContain('(DNF if not under )');
  });

  // A custom event with no limit: no prompt, but the same lines, so the card keeps its rows.
  it.each(LOCALES.flatMap((l) => [[l, null], [l, 'en'], [l, 'fr']] as const))(
    '%s/%s: no limit blanks the prompt and keeps its line count', (lang, second) => {
      const strings = getStrings(lang, second);
      for (const more of [{}, { scrambleDoubleCheck: true }, { isCumulative: true }]) {
        const blank = resultHeader(card(null, more), strings);
        expect(blank.split('\n')).toHaveLength(resultHeader(card('', more), strings).split('\n').length);
        expect(blank).not.toContain('DNF');
      }
    });
});
