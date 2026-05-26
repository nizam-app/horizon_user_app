import { requireApiBase } from './apiBase.js';

const CLAIM_NOT_FOUND = 'No claim found for this reference code';

/** Load member + driver fields from a previously submitted claim (HR-… code). */
export async function fetchPrefillFromReference(code) {
  const res = await fetch(`${requireApiBase()}/v1/claims/intake/${encodeURIComponent(code)}/prefill`, {
    headers: { Accept: 'application/json' },
  });
  const data = await res.json().catch(() => ({}));
  const errMsg = typeof data?.error === 'string' ? data.error : '';

  if (res.status === 404) {
    if (errMsg === CLAIM_NOT_FOUND) return null;
    throw new Error(
      'Pre-fill is not available on the API server yet (outdated deploy). Redeploy the latest horizon-backend on Render, then try again.'
    );
  }
  if (!res.ok) throw new Error(errMsg || `Could not load reference (${res.status})`);
  return data.prefill || null;
}