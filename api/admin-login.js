// POST /api/admin-login {email,password} → {access_token, expires_in}
// Credentials live in Supabase Auth, never in this repo. Only allow-listed admin emails receive a token.
// Local dev (no Supabase configured): issues a signed local token instead — DEV_SERVER only.
import { allow, send, fail, route, readJson, rateLimit, httpError } from './_lib/http.js';
import { passwordLogin } from './_lib/supabase.js';
import { isAdminEmail, issueLocalToken } from './_lib/auth.js';
import { localMode, localWritable } from './_lib/store.js';

export default route(async (req, res) => {
  if (!allow(req, res, ['POST'])) return;
  rateLimit(req, 'login', 8, 60_000);
  const { email, password } = await readJson(req, 5_000);
  const generic = () => fail(res, 401, 'invalid_credentials', 'Invalid email or password');
  if (typeof email !== 'string' || typeof password !== 'string' || email.length > 254 || password.length > 200) return generic();
  if (!isAdminEmail(email)) { if (!localMode()) await passwordLogin(email, password).catch(() => null); return generic(); } // same timing/response as a wrong password

  if (localMode()) {
    if (!localWritable()) throw httpError(503, 'not_configured', 'Admin sign-in needs the local dev server or a configured backend');
    const expected = process.env.ADMIN_PASSWORD;
    if (expected && password !== expected) return generic();
    return send(res, 200, { access_token: issueLocalToken(email.trim().toLowerCase()), expires_in: 3600 }, { 'Cache-Control': 'no-store' });
  }

  const session = await passwordLogin(email.trim(), password);
  if (!session?.access_token) return generic();
  send(res, 200, { access_token: session.access_token, expires_in: session.expires_in }, { 'Cache-Control': 'no-store' });
});
