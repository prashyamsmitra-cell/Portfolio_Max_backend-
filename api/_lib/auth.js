// Admin gate. Authentication = Supabase Auth (or a signed local token during local dev when
// Supabase is not configured); authorisation = ADMIN_EMAILS allow-list.
// The allow-list is mandatory: an empty list denies everyone (fail closed).
import { createHmac, timingSafeEqual } from 'node:crypto';
import { httpError } from './http.js';
import { getUser } from './supabase.js';
import { localMode, localWritable } from './store.js';

const adminEmails = () =>
  (process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

export const isAdminEmail = email => !!email && adminEmails().includes(String(email).toLowerCase());

/* ---- local (no-Supabase) tokens — only minted and accepted by the dev server ---- */
const SECRET = () => process.env.ADMIN_SESSION_SECRET || 'psm-local-dev-session';
const sign = payload => createHmac('sha256', SECRET()).update(payload).digest('base64url').slice(0, 40);

export function issueLocalToken(email) {
  const payload = Buffer.from(JSON.stringify({ email, exp: Date.now() + 3600 * 1000 })).toString('base64url');
  return `local.${payload}.${sign(payload)}`;
}

function readLocalToken(token) {
  const m = /^local\.([\w-]+)\.([\w-]+)$/.exec(token || '');
  if (!m) return null;
  const expected = sign(m[1]);
  const a = Buffer.from(expected), b = Buffer.from(m[2]);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const { email, exp } = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8'));
    if (!exp || exp < Date.now()) return null;
    return { email };
  } catch { return null; }
}

export async function requireAdmin(req) {
  const m = /^Bearer ([\w-]+\.[\w-]+\.[\w-]+)$/.exec(req.headers.authorization || '');
  if (!m) throw httpError(401, 'unauthorized', 'Authentication required');

  if (localMode()) {
    if (!localWritable()) throw httpError(401, 'unauthorized', 'Admin access needs the local dev server or a configured backend');
    const local = readLocalToken(m[1]);
    if (!local || !isAdminEmail(local.email)) throw httpError(403, 'forbidden', 'Not allowed');
    return local;
  }

  const user = await getUser(m[1]);
  if (!user || (!user.email_confirmed_at && !user.confirmed_at) || !isAdminEmail(user.email)) {
    throw httpError(403, 'forbidden', 'Not allowed');
  }
  return user;
}
