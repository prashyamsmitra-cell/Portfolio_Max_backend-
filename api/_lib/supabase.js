// Minimal Supabase REST client (PostgREST + Storage + Auth) using fetch. Server-side only.
import { httpError } from './http.js';

const env = name => {
  const v = process.env[name];
  if (!v) throw httpError(503, 'not_configured', 'Backend is not configured');
  return v;
};

export const supabaseUrl = () => env('SUPABASE_URL').replace(/\/+$/, '');

async function request(url, init = {}) {
  let res;
  try { res = await fetch(url, { ...init, signal: AbortSignal.timeout(8000) }); }
  catch { throw httpError(502, 'upstream_unreachable', 'Database is unreachable'); }
  return res;
}

/** Calls PostgREST with the service-role key. `query` is a URLSearchParams-compatible object (values are encoded). */
export async function db(table, { method = 'GET', query = {}, body, prefer } = {}) {
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  const qs = new URLSearchParams(query).toString();
  const res = await request(`${supabaseUrl()}/rest/v1/${table}${qs ? `?${qs}` : ''}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    if (detail.code === '23505') throw httpError(409, 'duplicate', 'A post with that slug already exists');
    console.error('[supabase] db error', res.status, detail.code || '');
    throw httpError(502, 'db_error', 'Database request failed');
  }
  return res.status === 204 ? null : res.json();
}

/** Verifies a user access token with Supabase Auth and returns the user (or null). */
export async function getUser(accessToken) {
  const res = await request(`${supabaseUrl()}/auth/v1/user`, {
    headers: { apikey: env('SUPABASE_ANON_KEY'), Authorization: `Bearer ${accessToken}` },
  });
  return res.ok ? res.json() : null;
}

export async function passwordLogin(email, password) {
  const res = await request(`${supabaseUrl()}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: env('SUPABASE_ANON_KEY'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return res.ok ? res.json() : null;
}

export async function storageUpload(bucket, path, bytes, contentType) {
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  const res = await request(`${supabaseUrl()}/storage/v1/object/${bucket}/${path}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': contentType, 'x-upsert': 'false' },
    body: bytes,
  });
  if (!res.ok) throw httpError(502, 'storage_error', 'Image upload failed');
  return `${supabaseUrl()}/storage/v1/object/public/${bucket}/${path}`;
}
