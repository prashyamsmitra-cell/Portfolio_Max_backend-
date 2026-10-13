// Input validation for posts. Whitelist fields, bound lengths, normalise.
import { httpError } from './http.js';

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const slugify = s =>
  String(s).toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 80).replace(/^-|-$/g, '');

const bad = msg => httpError(400, 'invalid_input', msg);

function str(v, name, { min = 0, max }) {
  if (typeof v !== 'string') throw bad(`${name} must be a string`);
  const s = v.trim();
  if (s.length < min || s.length > max) throw bad(`${name} must be ${min}–${max} characters`);
  return s;
}

function httpUrl(v, name) {
  if (v === null || v === '') return null;
  const s = str(v, name, { max: 500 });
  // Root-relative paths are same-origin by construction (local dev uploads return /uploads/…).
  // Rejects protocol-relative //host, backslashes, dot-segments and anything with a scheme.
  if (/^\/[A-Za-z0-9\-._~%/]+$/.test(s) && !s.includes('..')) return s;
  let u;
  try { u = new URL(s); } catch { throw bad(`${name} must be a valid URL`); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw bad(`${name} must be http(s)`);
  return u.toString();
}

function tags(v) {
  if (!Array.isArray(v) || v.length > 10) throw bad('tags must be an array of up to 10 items');
  return [...new Set(v.map(t => str(String(t), 'tag', { min: 1, max: 30 }).toLowerCase()))]
    .filter(t => /^[a-z0-9][a-z0-9 +#.\\-]*$/.test(t));
}

function linkedinUrls(v, key) {
  if (v === null || v === '') return null;
  const s = str(v, key, { min: 1, max: 500 });
  let u;
  try {
    u = new URL(s);
  } catch {
    throw bad(`${key} must be a valid URL`);
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw bad(`${key} must be http(s)`);
  return u.toString();
}

/** Photo slots on a post — ordered, first one doubles as the journal-row cover. */
function images(v) {
  if (!Array.isArray(v) || v.length > 9) throw bad('images must be an array of up to 9 items');
  return v.map((u, i) => httpUrl(u, `images[${i}]`)).filter(Boolean);
}

/** `partial` = PATCH semantics: only validate fields that are present. */
export function validatePost(input, { partial = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw bad('Body must be an object');
  const out = {};
  const has = k => Object.prototype.hasOwnProperty.call(input, k);

  if (!partial || has('title')) out.title = str(input.title, 'title', { min: 1, max: 160 });
  if (!partial || has('slug') || has('title')) {
    const raw = has('slug') && input.slug !== '' ? str(input.slug, 'slug', { min: 1, max: 80 }) : slugify(out.title || '');
    if (!SLUG_RE.test(raw)) throw bad('slug may only contain lowercase letters, numbers and hyphens');
    out.slug = raw;
  }
  if (!partial || has('excerpt')) out.excerpt = str(input.excerpt ?? '', 'excerpt', { max: 400 });
  if (!partial || has('content')) out.content = str(input.content ?? '', 'content', { max: 100_000 });
  if (!partial || has('cover_image')) out.cover_image = httpUrl(input.cover_image ?? null, 'cover_image');
  if (!partial || has('images')) out.images = images(input.images ?? []);
  if (!partial || has('tags')) out.tags = tags(input.tags ?? []);
  for (const k of ['published', 'featured']) {
    if (!partial || has(k)) {
      if (input[k] !== undefined && typeof input[k] !== 'boolean') throw bad(`${k} must be a boolean`);
      out[k] = !!input[k];
    }
  }
  for (const k of ['linkedin_post_id', 'linkedin_post_url', 'linkedin_comments_url', 'linkedin_shares_url', 'linkedin_likes_url']) {
    if (!partial || has(k)) {
      out[k] = linkedinUrls(input[k] ?? null, k);
    }
  }
  return out;
}

export const readingMinutes = content =>
  Math.max(1, Math.round((String(content).trim().split(/\s+/).filter(Boolean).length) / 200));
