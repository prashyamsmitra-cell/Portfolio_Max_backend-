// Post storage. Supabase is the source of truth when configured; otherwise posts live in
// data/posts.json so the journal can still be written to and read from during local dev.
// Reads work anywhere (the file ships with the deployment). Writes require the local dev
// server (DEV_SERVER=1) because serverless filesystems are read-only.
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { httpError } from './http.js';
import { db as supaDb } from './supabase.js';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
export const POSTS_FILE = join(root, 'data', 'posts.json');
export const UPLOADS_DIR = join(root, 'uploads');

/** Placeholder values shipped in .env.example are treated as unconfigured. */
export const supabaseConfigured = () => {
  const u = process.env.SUPABASE_URL;
  return !!u && /^https?:\/\//i.test(u) && !/your/i.test(u);
};

export const localMode = () => !supabaseConfigured();
export const localWritable = () => localMode() && process.env.DEV_SERVER === '1';

async function readAll() {
  if (!existsSync(POSTS_FILE)) return [];
  try { return JSON.parse(await readFile(POSTS_FILE, 'utf8')); } catch { return []; }
}

async function writeAll(rows) {
  if (!localWritable()) {
    throw httpError(503, 'not_configured', 'Writing needs the local dev server (npm run dev) or a configured Supabase backend');
  }
  await mkdir(dirname(POSTS_FILE), { recursive: true });
  const tmp = `${POSTS_FILE}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(rows, null, 2), 'utf8');
  await rename(tmp, POSTS_FILE);
}

const stripEq = v => String(v ?? '').replace(/^eq\./, '');
const pick = (row, select) => {
  if (!select || select.includes('*')) return { ...row };
  const out = {};
  for (const col of select) if (col in row) out[col] = row[col];
  return out;
};
const sortRows = (rows, order) => {
  const [col, dir] = String(order || '').split('.');
  if (!col) return rows;
  const desc = dir === 'desc';
  return [...rows].sort((a, b) => {
    const av = a[col] ?? '', bv = b[col] ?? '';
    if (av === bv) return 0;
    const cmp = av < bv ? -1 : 1;
    // published_at.desc.nullslast — nulls always sink to the end.
    if ((av === null || av === '') && (bv === null || bv === '')) return 0;
    if (av === null || av === '') return 1;
    if (bv === null || bv === '') return -1;
    return desc ? -cmp : cmp;
  });
};

/** PostgREST-shaped adapter over data/posts.json (same call signature as supabase.js `db`). */
async function localDb(table, { method = 'GET', query = {}, body } = {}) {
  if (table !== 'posts') throw httpError(404, 'not_found', 'Unknown table');
  const select = String(query.select || '').split(',').map(s => s.trim()).filter(Boolean);
  const rows = await readAll();
  const matches = r => ['slug', 'id', 'published'].every(k => !(k in query) || String(r[k]) === stripEq(query[k]));
  const affected = rows.filter(matches);
  const limit = query.limit ? Number(query.limit) : 0;

  if (method === 'POST') {
    const now = new Date().toISOString();
    const row = { id: randomUUID(), created_at: now, updated_at: now, published_at: null, published: false, featured: false, images: [], tags: [], ...body };
    if (rows.some(r => r.slug === row.slug)) throw httpError(409, 'duplicate', 'A post with that slug already exists');
    rows.push(row);
    await writeAll(rows);
    return [pick(row, select)];
  }

  if (method === 'PATCH') {
    const now = new Date().toISOString();
    if (!affected.length) return [];
    affected.forEach(r => Object.assign(r, body, { updated_at: now }));
    await writeAll(rows);
    return affected.map(r => pick(r, select));
  }

  if (method === 'DELETE') {
    if (!affected.length) return [];
    const keep = rows.filter(r => !affected.includes(r));
    await writeAll(keep);
    return affected.map(r => pick(r, select));
  }

  const ordered = sortRows(affected, query.order);
  return (limit ? ordered.slice(0, limit) : ordered).map(r => pick(r, select));
}

/** Single entry point used by the posts route: Supabase when configured, local file otherwise. */
export async function db(table, opts) {
  return supabaseConfigured() ? supaDb(table, opts) : localDb(table, opts);
}
