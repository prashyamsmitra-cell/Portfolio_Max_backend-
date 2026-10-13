// POST /api/upload {contentType, data(base64)} → {url}   (admin only; post photos)
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { allow, send, fail, route, readJson, httpError } from './_lib/http.js';
import { requireAdmin } from './_lib/auth.js';
import { storageUpload } from './_lib/supabase.js';
import { localMode, localWritable, UPLOADS_DIR } from './_lib/store.js';

const MAX_BYTES = 3 * 1024 * 1024;
// Verify real content via magic bytes — never trust the client's declared type alone.
const TYPES = {
  'image/png':  { ext: 'png',  ok: b => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/jpeg': { ext: 'jpg',  ok: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/webp': { ext: 'webp', ok: b => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
};

export default route(async (req, res) => {
  if (!allow(req, res, ['POST'])) return;
  await requireAdmin(req);
  const { contentType, data } = await readJson(req, Math.ceil(MAX_BYTES * 1.4));
  const type = TYPES[contentType];
  if (!type || typeof data !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw httpError(400, 'invalid_input', 'Upload a PNG, JPEG or WebP image');
  const bytes = Buffer.from(data, 'base64');
  if (bytes.length === 0 || bytes.length > MAX_BYTES) throw httpError(413, 'too_large', 'Image must be under 3 MB');
  if (!type.ok(bytes)) throw httpError(400, 'invalid_input', 'File content does not match its type');
  if (localMode()) {
    if (!localWritable()) throw httpError(503, 'not_configured', 'Uploads need the local dev server or a configured backend');
    const name = `${randomUUID()}.${type.ext}`;
    await mkdir(UPLOADS_DIR, { recursive: true });
    await writeFile(join(UPLOADS_DIR, name), bytes);
    return send(res, 201, { url: `/uploads/${name}` }, { 'Cache-Control': 'no-store' });
  }
  const url = await storageUpload('post-covers', `covers/${randomUUID()}.${type.ext}`, bytes, contentType);
  send(res, 201, { url }, { 'Cache-Control': 'no-store' });
});
