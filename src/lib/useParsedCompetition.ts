import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/useAuth';
import { fetchErrorKey, fetchWcif } from '../auth/wca';
import { getCachedWcif, setCachedWcif } from './wcifCache';
import * as analytics from './analytics';
import type { WCIF } from '../types/wcif';
import type { ParsedWCIF } from './wcif-parser';

export type LoadStatus = 'idle' | 'fetching' | 'parsing' | 'ready' | 'error';

/** The competition's WCIF, cached or fetched, parsed once. A `null` id loads nothing. */
export function useParsedCompetition(competitionId: string | null, parse: (wcif: WCIF) => ParsedWCIF) {
  const { t } = useTranslation();
  const { token } = useAuth();
  const [status, setStatus] = useState<LoadStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedWCIF | null>(null);

  useEffect(() => {
    // A dead token 401s, the 401 renews it, and the fresh token re-runs this. Once parsed, a
    // later renewal must not parse again over the page's state.
    if (!competitionId || !token || parsed) return;
    let cancelled = false;
    void (async () => {
      setStatus('fetching');
      setError(null);
      // React state is stale in this closure, so the error event needs its own step.
      let stage: analytics.ErrorStage = 'fetch';
      try {
        const wcif = getCachedWcif(competitionId) ?? await fetchWcif(competitionId, token.access_token);
        if (cancelled) return;
        setCachedWcif(competitionId, wcif);
        setStatus('parsing');
        stage = 'parse';
        setParsed(parse(wcif));
        setStatus('ready');
      } catch (e) {
        if (cancelled) return;
        analytics.send(analytics.buildErrorEvent(competitionId, stage, e));
        const key = fetchErrorKey(e);
        setError(key ? t(key) : String(e));
        setStatus('error');
      }
    })();
    return () => { cancelled = true; };
  // `parse` is read once, with the first render's settings.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [competitionId, token]);

  return { status, error, parsed };
}
