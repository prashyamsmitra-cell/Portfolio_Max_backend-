// API tests: real handlers over HTTP, with Supabase + GitHub replaced by an in-memory fetch stub.
// Run: node scripts/test-api.mjs
import assert from 'node:assert/strict';
import nodemailer from 'nodemailer';
import { createServer } from './dev.mjs';

process.env.SUPABASE_URL = 'https://fake.supabase.test';
process.env.SUPABASE_ANON_KEY = 'anon';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-secret';
process.env.ADMIN_EMAILS = 'admin@example.com';
process.env.GITHUB_TOKEN = 'ghp_SECRET_TOKEN';
process.env.GITHUB_USERNAME = 'octo';

const realFetch = globalThis.fetch;
let posts = [
  { id: '11111111-1111-4111-8111-111111111111', title: 'Live', slug: 'live', excerpt: 'e', content: 'word '.repeat(450), cover_image: null, tags: ['ai'], published: true, featured: true, published_at: '2026-01-02T00:00:00Z', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
  { id: '22222222-2222-4222-8222-222222222222', title: 'Secret draft', slug: 'draft', excerpt: '', content: 'private', cover_image: null, tags: [], published: false, featured: false, published_at: null, created_at: '2026-01-03T00:00:00Z', updated_at: '2026-01-03T00:00:00Z' },
];
const seenCalls = [];
let ghFail = false;

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  if (url.hostname === 'api.github.com') {
    seenCalls.push({ host: url.hostname, auth: init.headers?.Authorization });
    if (ghFail) return new Response('{}', { status: 403 });
    if (url.pathname === '/users/octo') return Response.json({ login: 'octo', html_url: 'https://github.com/octo', public_repos: 3, followers: 5 });
    return Response.json([
      { name: 'a', full_name: 'octo/a', description: 'd', html_url: 'u', homepage: '', language: 'Python', stargazers_count: 4, forks_count: 1, topics: ['ai'], pushed_at: '2026-02-01T00:00:00Z', created_at: '2025-01-01T00:00:00Z', fork: false, archived: false },
      { name: 'forked', full_name: 'octo/forked', language: 'Go', stargazers_count: 99, forks_count: 0, pushed_at: '2026-03-01T00:00:00Z', fork: true, archived: false },
      { name: 'old', full_name: 'octo/old', language: 'C', stargazers_count: 1, forks_count: 0, pushed_at: '2020-03-01T00:00:00Z', fork: false, archived: true },
    ]);
  }
  if (url.hostname !== 'fake.supabase.test') return realFetch(input, init);
  const p = url.pathname;
  if (p === '/auth/v1/user') {
    const t = init.headers.Authorization.replace('Bearer ', '');
    if (t === 'aaa.bbb.admin') return Response.json({ email: 'admin@example.com', email_confirmed_at: 'x' });
    if (t === 'aaa.bbb.user') return Response.json({ email: 'rando@example.com', email_confirmed_at: 'x' });
    return new Response('{}', { status: 401 });
  }
  if (p === '/auth/v1/token') {
    const b = JSON.parse(init.body);
    return b.password === 'right' ? Response.json({ access_token: 'aaa.bbb.admin', expires_in: 3600 }) : new Response('{}', { status: 400 });
  }
  if (p.startsWith('/storage/v1/object/post-covers/')) return Response.json({ Key: 'ok' });
  if (p === '/rest/v1/posts') {
    const q = url.searchParams;
    const eq = k => (q.get(k) || '').replace(/^eq\./, '');
    let rows = posts.filter(r => (!q.get('published') || String(r.published) === eq('published')) && (!q.get('slug') || r.slug === eq('slug')) && (!q.get('id') || r.id === eq('id')));
    if (init.method === 'POST') {
      const row = { id: '33333333-3333-4333-8333-333333333333', created_at: 'now', updated_at: 'now', published_at: null, featured: false, published: false, ...JSON.parse(init.body) };
      if (posts.some(r => r.slug === row.slug)) return Response.json({ code: '23505' }, { status: 409 });
      posts.push(row); return Response.json([row], { status: 201 });
    }
    if (init.method === 'PATCH') { rows.forEach(r => Object.assign(r, JSON.parse(init.body))); return Response.json(rows); }
    if (init.method === 'DELETE') { posts = posts.filter(r => !rows.includes(r)); return Response.json(rows); }
    return Response.json(rows);
  }
  return new Response('{}', { status: 404 });
};

const server = createServer();
await new Promise(r => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;
const call = (path, { method = 'GET', token, body, headers = {} } = {}) => realFetch(base + path, {
  method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
  body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
});
let n = 0;
const t = async (name, fn) => { try { await fn(); n++; console.log('  ✓', name); } catch (e) { console.error('  ✗', name, '\n   ', e.message); process.exitCode = 1; } };

console.log('posts — public');
await t('lists published only, no content, with reading time', async () => {
  const j = await (await call('/api/posts')).json();
  assert.equal(j.posts.length, 1); assert.equal(j.posts[0].slug, 'live');
  assert.equal('content' in j.posts[0], false); assert.equal(j.posts[0].reading_minutes, 2);
});
await t('draft slug is a 404 for the public', async () => assert.equal((await call('/api/posts?slug=draft')).status, 404));
await t('published slug returns content', async () => { const j = await (await call('/api/posts?slug=live')).json(); assert.ok(j.post.content.length > 100); assert.equal('published' in j.post, false); });
await t('malicious slug is rejected before reaching the DB', async () => assert.equal((await call('/api/posts?slug=' + encodeURIComponent('x,published.eq.false'))).status, 404));
await t('?all=1 requires auth', async () => assert.equal((await call('/api/posts?all=1')).status, 401));

console.log('posts — admin');
await t('anonymous write → 401', async () => assert.equal((await call('/api/posts', { method: 'POST', body: { title: 'x' } })).status, 401));
await t('non-admin user write → 403', async () => assert.equal((await call('/api/posts', { method: 'POST', token: 'aaa.bbb.user', body: { title: 'x' } })).status, 403));
await t('garbage token → 401', async () => assert.equal((await call('/api/posts', { method: 'POST', token: 'notatoken', body: { title: 'x' } })).status, 401));
await t('admin can list drafts', async () => { const j = await (await call('/api/posts?all=1', { token: 'aaa.bbb.admin' })).json(); assert.equal(j.posts.length, 2); });
await t('create validates input', async () => {
  assert.equal((await call('/api/posts', { method: 'POST', token: 'aaa.bbb.admin', body: { title: '' } })).status, 400);
  assert.equal((await call('/api/posts', { method: 'POST', token: 'aaa.bbb.admin', body: { title: 'ok', cover_image: 'javascript:alert(1)' } })).status, 400);
  assert.equal((await call('/api/posts', { method: 'POST', token: 'aaa.bbb.admin', body: '{bad json' })).status, 400);
});
let created;
await t('create → slug auto-generated, whitelist enforced', async () => {
  const r = await call('/api/posts', { method: 'POST', token: 'aaa.bbb.admin', body: { title: 'My First AI Project!', content: 'hi', tags: ['AI', 'ai', 'Next.js'], published: true, id: 'evil', created_at: '1999' } });
  assert.equal(r.status, 201); created = (await r.json()).post;
  assert.equal(created.slug, 'my-first-ai-project'); assert.deepEqual(created.tags, ['ai', 'next.js']); assert.notEqual(created.id, 'evil'); assert.notEqual(created.created_at, '1999'); assert.ok(created.published_at);
});
await t('duplicate slug → 409', async () => assert.equal((await call('/api/posts', { method: 'POST', token: 'aaa.bbb.admin', body: { title: 'Live', slug: 'live' } })).status, 409));
await t('update + unpublish hides it from the public', async () => {
  const r = await call(`/api/posts?id=${created.id}`, { method: 'PATCH', token: 'aaa.bbb.admin', body: { published: false, featured: true } });
  assert.equal(r.status, 200); assert.equal((await call('/api/posts?slug=my-first-ai-project')).status, 404);
});
await t('bad id → 400', async () => assert.equal((await call('/api/posts?id=1;drop', { method: 'DELETE', token: 'aaa.bbb.admin' })).status, 400));
await t('delete', async () => { assert.equal((await call(`/api/posts?id=${created.id}`, { method: 'DELETE', token: 'aaa.bbb.admin' })).status, 200); assert.equal((await call(`/api/posts?id=${created.id}`, { method: 'DELETE', token: 'aaa.bbb.admin' })).status, 404); });

console.log('auth + upload');
await t('login: wrong password → 401, generic', async () => { const r = await call('/api/admin-login', { method: 'POST', body: { email: 'admin@example.com', password: 'nope' } }); assert.equal(r.status, 401); });
await t('login: non-admin email never gets a token', async () => { const r = await call('/api/admin-login', { method: 'POST', body: { email: 'rando@example.com', password: 'right' } }); assert.equal(r.status, 401); });
await t('login: admin → token', async () => { const j = await (await call('/api/admin-login', { method: 'POST', body: { email: 'admin@example.com', password: 'right' } })).json(); assert.equal(j.access_token, 'aaa.bbb.admin'); });
await t('local admin login stays disabled without Supabase outside local development', async () => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const devServer = process.env.DEV_SERVER;
  process.env.DEV_SERVER = '0';
  delete process.env.SUPABASE_URL;
  let r;
  try {
    r = await call('/api/admin-login', { method: 'POST', body: { email: 'admin@example.com', password: 'anything' } });
  } finally {
    process.env.SUPABASE_URL = supabaseUrl;
    if (devServer === undefined) delete process.env.DEV_SERVER;
    else process.env.DEV_SERVER = devServer;
  }
  assert.equal(r.status, 503);
});
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]).toString('base64');
await t('upload requires admin', async () => assert.equal((await call('/api/upload', { method: 'POST', body: { contentType: 'image/png', data: png } })).status, 401));
await t('upload rejects spoofed content (HTML as PNG)', async () => assert.equal((await call('/api/upload', { method: 'POST', token: 'aaa.bbb.admin', body: { contentType: 'image/png', data: Buffer.from('<script>alert(1)</script>').toString('base64') } })).status, 400));
await t('upload rejects SVG', async () => assert.equal((await call('/api/upload', { method: 'POST', token: 'aaa.bbb.admin', body: { contentType: 'image/svg+xml', data: png } })).status, 400));
await t('upload accepts a real PNG', async () => { const r = await call('/api/upload', { method: 'POST', token: 'aaa.bbb.admin', body: { contentType: 'image/png', data: png } }); assert.equal(r.status, 201); assert.match((await r.json()).url, /post-covers\/covers\/.+\.png$/); });

console.log('github');
await t('filters forks/archived, aggregates languages, never leaks the token', async () => {
  const r = await call('/api/github'); const text = await r.text(); const j = JSON.parse(text);
  assert.equal(r.status, 200); assert.deepEqual(j.repos.map(x => x.name), ['a']); assert.deepEqual(j.languages, { Python: 1 }); assert.equal(j.totals.stars, 4);
  assert.ok(!text.includes('SECRET_TOKEN')); assert.ok(r.headers.get('cache-control').includes('s-maxage'));
  assert.ok(seenCalls.every(c => c.auth === 'Bearer ghp_SECRET_TOKEN'), 'token sent upstream, server-side only');
});
await t('wrong method → 405', async () => assert.equal((await call('/api/github', { method: 'POST', body: {} })).status, 405));

console.log('contact');
await t('contact rejects non-POST requests', async () => {
  assert.equal((await call('/api/contact', { headers: { 'x-forwarded-for': '198.51.100.1' } })).status, 405);
});
await t('contact validates email and message before SMTP', async () => {
  const r = await call('/api/contact', {
    method: 'POST',
    headers: { 'x-forwarded-for': '198.51.100.2' },
    body: { name: 'Guest', email: 'not-an-email', message: 'Too short' },
  });
  assert.equal(r.status, 400);
});
await t('contact reports missing SMTP configuration', async () => {
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  delete process.env.CONTACT_EMAIL;
  const r = await call('/api/contact', {
    method: 'POST',
    headers: { 'x-forwarded-for': '198.51.100.3' },
    body: { email: 'guest@example.com', message: 'A valid message for testing.' },
  });
  assert.equal(r.status, 503);
  assert.equal((await r.json()).error.code, 'email_not_configured');
});
const originalCreateTransport = nodemailer.createTransport;
const sentMessages = [];
nodemailer.createTransport = () => ({
  sendMail: async options => { sentMessages.push(options); return { messageId: 'test' }; },
  close() {},
});
process.env.SMTP_HOST = 'smtp.example.com';
process.env.SMTP_PORT = '465';
process.env.SMTP_USER = 'sender@example.com';
process.env.SMTP_PASS = 'test-password';
process.env.CONTACT_EMAIL = 'prashyams@gmail.com';
await t('contact sends the enquiry and an escaped confirmation email', async () => {
  const r = await call('/api/contact', {
    method: 'POST',
    headers: { 'x-forwarded-for': '198.51.100.4' },
    body: { name: '<script>Guest</script>', email: 'guest@example.com', message: 'I would like to discuss a product idea.' },
  });
  assert.equal(r.status, 200);
  assert.equal(sentMessages.length, 2);
  assert.equal(sentMessages[0].to, 'prashyams@gmail.com');
  assert.equal(sentMessages[0].replyTo, 'guest@example.com');
  assert.ok(sentMessages[0].html.includes('&lt;script&gt;Guest&lt;/script&gt;'));
  assert.equal(sentMessages[1].to, 'guest@example.com');
  assert.equal(sentMessages[1].subject, 'Thanks for reaching out');
});
await t('contact honeypot accepts without sending mail', async () => {
  const before = sentMessages.length;
  const r = await call('/api/contact', {
    method: 'POST',
    headers: { 'x-forwarded-for': '198.51.100.5' },
    body: { email: 'bot@example.com', message: 'A valid message from a bot.', website: 'spam' },
  });
  assert.equal(r.status, 200);
  assert.equal(sentMessages.length, before);
});
await t('contact reports SMTP delivery failures', async () => {
  nodemailer.createTransport = () => ({
    sendMail: async () => { throw Object.assign(new Error('SMTP unavailable'), { code: 'ECONNECTION' }); },
    close() {},
  });
  const r = await call('/api/contact', {
    method: 'POST',
    headers: { 'x-forwarded-for': '198.51.100.6' },
    body: { email: 'guest@example.com', message: 'A valid message for testing.' },
  });
  assert.equal(r.status, 502);
  assert.equal((await r.json()).error.code, 'email_delivery_failed');
});
nodemailer.createTransport = originalCreateTransport;

console.log('cors & cross-origin security');
await t('OPTIONS preflight from allowed origin returns 204 with CORS headers', async () => {
  const r = await call('/api/posts', { method: 'OPTIONS', headers: { Origin: 'http://localhost:3000' } });
  assert.equal(r.status, 204);
  assert.equal(r.headers.get('access-control-allow-origin'), 'http://localhost:3000');
  assert.ok(r.headers.get('access-control-allow-methods').includes('POST'));
  assert.ok(r.headers.get('access-control-allow-headers').includes('Authorization'));
  assert.equal(r.headers.get('access-control-max-age'), '86400');
});
await t('GET from allowed origin includes Access-Control-Allow-Origin', async () => {
  const r = await call('/api/posts', { headers: { Origin: 'http://localhost:3000' } });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('access-control-allow-origin'), 'http://localhost:3000');
  assert.equal(r.headers.get('cross-origin-resource-policy'), 'cross-origin');
});
await t('request from disallowed origin does not receive Access-Control-Allow-Origin', async () => {
  const r = await call('/api/posts', { headers: { Origin: 'https://malicious-site.example.com' } });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('access-control-allow-origin'), null);
});
await t('preflight from disallowed origin does not grant allow headers', async () => {
  const r = await call('/api/posts', { method: 'OPTIONS', headers: { Origin: 'https://malicious-site.example.com' } });
  assert.equal(r.status, 204);
  assert.equal(r.headers.get('access-control-allow-origin'), null);
  assert.equal(r.headers.get('access-control-allow-methods'), null);
});
console.log(`\n${n} passed${process.exitCode ? ' — with failures' : ''}`);
server.close();
