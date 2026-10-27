import type { ScorecardStrings } from '../lib/i18n';
import type { ScorecardEntry } from '../lib/wcif-parser';

type Card = Pick<ScorecardEntry, 'eventId' | 'limit' | 'isCumulative' | 'scrambleDoubleCheck'>;

/** The result column's header: "Result" over the limit prompt, one line per language. */
export function resultHeader(card: Card, strings: ScorecardStrings): string {
  const isMBF = card.eventId === '333mbf';
  const limit = card.limit ?? '';
  // The 6-column layout's result column is narrower, so compact suffixes keep the bilingual
  // header off a fourth line.
  const suffix = card.scrambleDoubleCheck
    ? (card.isCumulative ? strings.shortCumulativeSuffix(limit)
       : isMBF           ? strings.mbfSuffix
       :                   strings.shortDnfSuffix(limit))
    : (card.isCumulative ? strings.cumulativeSuffix(limit)
       : isMBF           ? strings.mbfSuffix
       :                   strings.dnfSuffix(limit));
  // No limit still takes the prompt's lines, so the rows keep every other card's height.
  const sufLines = suffix.split('\n').map((l) => (card.limit === null ? ' ' : l));

  // Prefix and suffix each hold two lines; merge per language so each takes exactly one.
  const prefLines = strings.resultPrefix.split('\n');
  return prefLines.length === sufLines.length && prefLines.length > 1
    ? prefLines.map((p, i) => `${p} ${sufLines[i]}`).join('\n')
    : `${strings.resultPrefix}\n${sufLines.join('\n')}`;
}
