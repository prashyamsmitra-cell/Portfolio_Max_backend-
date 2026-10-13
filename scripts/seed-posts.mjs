// One-off: copy the entries in js/data/posts.fallback.js into the Supabase `posts` table (as published posts).
// The bundled journal is empty by design now — posts are written through #/admin/posts — so this only
// seeds something if you put demo entries back in the fallback file first.
// Idempotent — existing slugs are left untouched. Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (see .env.example).
// Usage: node --env-file=.env scripts/seed-posts.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// The data files assign `window.DATA = …` then write `DATA.x = …`, exactly as in the browser —
// so the sandbox's `window` IS the context object.
const ctx = {}; ctx.window = ctx; vm.createContext(ctx);
vm.runInContext(readFileSync(new URL('../js/data/posts.fallback.js', import.meta.url), 'utf8') + ';this.J = DATA.journal;', ctx);

const rows = ctx.J.map(j => {
  const d = new Date(j.date);
  const iso = isNaN(d) ? new Date().toISOString() : d.toISOString();
  return { title: j.title, slug: j.slug, excerpt: j.excerpt, content: j.body.join('\n\n'), tags: [j.category.toLowerCase()], published: true, featured: false, created_at: iso, published_at: iso };
});

if (!rows.length) {
  console.log('Nothing to seed: js/data/posts.fallback.js is empty. Write posts at #/admin/posts instead.');
  process.exit(0);
}

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) { console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first.'); process.exit(1); }

const res = await fetch(`${SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/posts?on_conflict=slug`, {
  method: 'POST',
  headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=representation' },
  body: JSON.stringify(rows),
});
if (!res.ok) { console.error('Seed failed:', res.status, await res.text()); process.exit(1); }
console.log(`Inserted ${(await res.json()).length} of ${rows.length} posts (others already existed).`);
