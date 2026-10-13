// Small HTTP helpers shared by all API routes. No dependencies.

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'cross-origin',
};

/**
 * Returns allowed origins parsed from ALLOWED_ORIGINS env var.
 * Falls back to local dev origins if unset.
 */
export function getAllowedOrigins() {
  const configured = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(s => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  if (configured.length > 0) return configured;
  // Local development defaults
  return [
    'http://localhost:3000',
    'http://localhost:5000',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:5000',
  ];
}

/**
 * Applies CORS headers to the response if the request origin is allowed.
 * Returns true if the origin was allowed, false otherwise.
 */
export function applyCors(req, res) {
  const origin = req.headers.origin;
  if (!origin) return false;

  const allowedOrigins = getAllowedOrigins();
  const isAllowed = allowedOrigins.includes(origin) || allowedOrigins.includes('*');

  if (isAllowed) {
    // Explicit origin echo rather than wildcard for safety with auth tokens
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  return isAllowed;
}

/**
 * Handles CORS preflight OPTIONS requests.
 * Returns true if the request was an OPTIONS preflight and was handled, false otherwise.
 */
export function handlePreflight(req, res) {
  if (req.method !== 'OPTIONS') return false;

  const isAllowed = applyCors(req, res);
  if (isAllowed) {
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
  res.statusCode = 204;
  res.end();
  return true;
}

export function send(res, status, payload, headers = {}) {
  const all = { 'Content-Type': 'application/json; charset=utf-8', ...SECURITY_HEADERS, ...headers };
  for (const [k, v] of Object.entries(all)) res.setHeader(k, v);
  res.statusCode = status;
  res.end(JSON.stringify(payload));
}

export const fail = (res, status, code, message) =>
  send(res, status, { error: { code, message } }, { 'Cache-Control': 'no-store' });

/** Rejects (and answers 405) unless req.method is in `allowed`. */
export function allow(req, res, allowed) {
  if (allowed.includes(req.method)) return true;
  res.setHeader('Allow', allowed.join(', '));
  fail(res, 405, 'method_not_allowed', 'Method not allowed');
  return false;
}

/** Reads a JSON body with a hard size cap. Works with Vercel's pre-parsed req.body and raw streams. */
export async function readJson(req, maxBytes = 200_000) {
  if (req.body && typeof req.body === 'object') {
    if (JSON.stringify(req.body).length > maxBytes) throw httpError(413, 'too_large', 'Request body too large');
    return req.body;
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw httpError(413, 'too_large', 'Request body too large');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw httpError(400, 'bad_json', 'Body must be valid JSON'); }
}

export function httpError(status, code, message) {
  return Object.assign(new Error(message), { status, code, expose: true });
}

/** Wraps a handler with CORS preflight handling, error catching, and safe responses. */
export const route = handler => async (req, res) => {
  if (handlePreflight(req, res)) return;
  applyCors(req, res);
  try { await handler(req, res); }
  catch (err) {
    if (err?.expose) return fail(res, err.status, err.code, err.message);
    console.error('[api] unhandled error:', err?.message || err); // message only — never log secrets/bodies
    fail(res, 500, 'internal', 'Something went wrong');
  }
};

// Best-effort, per-instance limiter (serverless instances are ephemeral; this blunts casual abuse only).
const buckets = new Map();
export function rateLimit(req, key, limit, windowMs) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  const id = `${key}:${ip}`;
  const now = Date.now();
  const hits = (buckets.get(id) || []).filter(t => now - t < windowMs);
  hits.push(now);
  buckets.set(id, hits);
  if (buckets.size > 5000) buckets.clear();
  if (hits.length > limit) throw httpError(429, 'rate_limited', 'Too many requests — try again shortly');
}
