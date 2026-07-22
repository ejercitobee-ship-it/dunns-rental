import { useEffect, useState } from 'react';
import { settingsApi } from './api';
import { PAST_DUE_MONTHS } from './rent';

/**
 * The past-due threshold (months) from Settings, defaulting to PAST_DUE_MONTHS.
 * Fetched once. If the caller lacks settings access, it quietly keeps the
 * default, so the flag still works, just at the standard threshold.
 */
export function usePastDueMonths(): number {
  const [months, setMonths] = useState(PAST_DUE_MONTHS);
  useEffect(() => {
    settingsApi
      .get()
      .then((s) => {
        const n = s?.rent?.pastDueMonths;
        if (typeof n === 'number' && n >= 1) setMonths(Math.floor(n));
      })
      .catch(() => {});
  }, []);
  return months;
}
