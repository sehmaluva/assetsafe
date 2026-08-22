import { z } from 'zod';

function emptyToUndefined(val: unknown): unknown {
  if (val === '' || val == null) return undefined;
  return val;
}

/** Optional numeric form field (empty input → undefined). */
export function optionalFormNumber() {
  return z.preprocess((val) => {
    const normalized = emptyToUndefined(val);
    if (normalized === undefined) return undefined;
    const n = Number(normalized);
    return Number.isNaN(n) ? undefined : n;
  }, z.number().optional());
}

/** Required numeric id from autocomplete (0 / empty → validation error). */
export function requiredFormId(message: string) {
  return z.preprocess(
    (val) => {
      const normalized = emptyToUndefined(val);
      if (normalized === undefined) return undefined;
      const n = Number(normalized);
      return Number.isNaN(n) ? undefined : n;
    },
    z.number({ error: message }).min(1, message),
  );
}
