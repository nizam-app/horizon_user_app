/** Horizon API origin (no trailing slash). */

function trimSlash(s) {
  return String(s || '').replace(/\/$/, '');
}

export function apiBase() {
  const fromEnv = import.meta.env.VITE_API_BASE_URL?.trim();
  if (fromEnv) return trimSlash(fromEnv);

  if (import.meta.env.PROD) {
    return '';
  }

  const hostOverride = import.meta.env.VITE_API_HOST?.trim();
  const port = String(import.meta.env.VITE_API_PORT || '3000').replace(/\D/g, '') || '3000';
  if (hostOverride) return trimSlash(`http://${hostOverride}:${port}`);

  if (typeof window !== 'undefined' && window.location?.hostname) {
    return trimSlash(`http://${window.location.hostname}:${port}`);
  }

  return `http://127.0.0.1:${port}`;
}

const MISSING_API =
  'VITE_API_BASE_URL is not set. In Vercel/Netlify: Project → Environment variables → add VITE_API_BASE_URL (HTTPS API URL, no trailing slash), then redeploy. Your API must allow this site in CORS.';

export function requireApiBase() {
  const b = apiBase();
  if (!b) throw new Error(MISSING_API);
  return b;
}
