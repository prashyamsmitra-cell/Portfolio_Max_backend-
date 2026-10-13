// /api/posts — public reads of published posts; admin-only create/update/delete.
//   GET    /api/posts                 published posts (no content)
//   GET    /api/posts?slug=my-post    one published post (with content)
//   GET    /api/posts?all=1           admin: every post incl. drafts, with content
//   POST   /api/posts                 admin: create
//   PATCH  /api/posts?id=<uuid>       admin: update
//   DELETE /api/posts?id=<uuid>       admin: delete
import { allow, send, fail, route, readJson, httpError } from './_lib/http.js';
import { db } from './_lib/store.js';
import { requireAdmin } from './_lib/auth.js';
import { validatePost, readingMinutes, SLUG_RE, UUID_RE } from './_lib/validate.js';

const LIST_COLS = 'id,title,slug,excerpt,cover_image,images,tags,featured,published_at,created_at,updated_at,linkedin_post_id,linkedin_post_url,linkedin_comments_url,linkedin_shares_url,linkedin_likes_url';
const FULL_COLS = `${LIST_COLS},content,published`;
const withMeta = p => ({ ...p, reading_minutes: p.content != null ? readingMinutes(p.content) : undefined });
const idParam = url => {
  const id = url.searchParams.get('id');
  if (!id || !UUID_RE.test(id)) throw httpError(400, 'invalid_input', 'A valid id is required');
  return id;
};

export default route(async (req, res) => {
  if (!allow(req, res, ['GET', 'POST', 'PATCH', 'DELETE'])) return;
  const url = new URL(req.url, 'http://x');

  if (req.method === 'GET') {
    if (url.searchParams.get('all') === '1') {
      await requireAdmin(req);
      const rows = await db('posts', { query: { select: FULL_COLS, order: 'created_at.desc' } });
      return send(res, 200, { posts: rows.map(withMeta) }, { 'Cache-Control': 'no-store' });
    }
    const slug = url.searchParams.get('slug');
    if (slug) {
      if (!SLUG_RE.test(slug) || slug.length > 80) return fail(res, 404, 'not_found', 'Post not found');
      const rows = await db('posts', { query: { select: FULL_COLS, slug: `eq.${slug}`, published: 'eq.true', limit: '1' } });
      if (!rows.length) return fail(res, 404, 'not_found', 'Post not found');
      const { published, ...post } = rows[0];
      return send(res, 200, { post: withMeta(post) }, { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' });
    }
    // List: need content only to compute reading time, so select it and drop it before sending.
    const rows = await db('posts', { query: { select: `${LIST_COLS},content`, published: 'eq.true', order: 'published_at.desc.nullslast', limit: '100' } });
    const posts = rows.map(({ content, ...p }) => ({ ...p, reading_minutes: readingMinutes(content || '') }));
    return send(res, 200, { posts }, { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' });
  }

  await requireAdmin(req);

  if (req.method === 'POST') {
    const data = validatePost(await readJson(req));
    if (data.published) data.published_at = new Date().toISOString();
    const [row] = await db('posts', { method: 'POST', body: data, prefer: 'return=representation', query: { select: FULL_COLS } });
    return send(res, 201, { post: withMeta(row) }, { 'Cache-Control': 'no-store' });
  }

  if (req.method === 'PATCH') {
    const id = idParam(url);
    const data = validatePost(await readJson(req), { partial: true });
    if ('published' in data) {
      const [cur] = await db('posts', { query: { select: 'published,published_at', id: `eq.${id}`, limit: '1' } });
      if (!cur) return fail(res, 404, 'not_found', 'Post not found');
      if (data.published && !cur.published_at) data.published_at = new Date().toISOString(); // first publish only
    }
    const rows = await db('posts', { method: 'PATCH', query: { id: `eq.${id}`, select: FULL_COLS }, body: data, prefer: 'return=representation' });
    if (!rows.length) return fail(res, 404, 'not_found', 'Post not found');
    return send(res, 200, { post: withMeta(rows[0]) }, { 'Cache-Control': 'no-store' });
  }

  // DELETE
  const id = idParam(url);
  const rows = await db('posts', { method: 'DELETE', query: { id: `eq.${id}`, select: 'id' }, prefer: 'return=representation' });
  if (!rows.length) return fail(res, 404, 'not_found', 'Post not found');
  send(res, 200, { deleted: id }, { 'Cache-Control': 'no-store' });
});
