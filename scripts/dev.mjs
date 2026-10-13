// Zero-dependency dev server for backend: mounts /api/* handlers and serves /uploads/*.
// Usage: node scripts/dev.mjs   (reads .env if present; PORT defaults to 3001)
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
if (existsSync(join(root, '.env'))) {
  for (const line of readFileSync(join(root, '.env'), 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*([^#\n]*)/.exec(line);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim();
  }
}
// Tells the API layer it may write local posts/uploads and mint local admin tokens.
process.env.DEV_SERVER = '1';

const MIME = {
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml'
};

export function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      // 1. API handlers
      if (url.pathname.startsWith('/api/')) {
        const name = url.pathname.slice(5);
        const apiFile = join(root, 'api', `${name}.js`);
        if (!/^[a-z-]+$/.test(name) || !existsSync(apiFile)) {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          return res.end('{"error":{"code":"not_found","message":"Endpoint not found"}}');
        }
        const mod = await import(pathToFileURL(apiFile).href);
        return mod.default(req, res);
      }

      // 2. Uploads folder (served with CORS so frontend can display local images)
      if (url.pathname.startsWith('/uploads/')) {
        let rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
        const file = resolve(root, rel);
        const inUploads = file.startsWith(resolve(root, 'uploads') + sep) || file.startsWith(resolve(root, 'uploads') + '/');
        if (!inUploads || !existsSync(file)) {
          res.statusCode = 404;
          return res.end('Not found');
        }
        const origin = req.headers.origin;
        if (origin) {
          res.setHeader('Access-Control-Allow-Origin', origin);
          res.setHeader('Vary', 'Origin');
        }
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        res.setHeader('Content-Type', MIME[extname(file)] || 'application/octet-stream');
        const body = await readFile(file);
        return res.end(body);
      }

      // 3. Health check
      if (url.pathname === '/' || url.pathname === '/health') {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        return res.end(JSON.stringify({ status: 'ok', service: 'portfolio-backend' }));
      }

      // Everything else is not found on the backend
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end('{"error":{"code":"not_found","message":"Not found"}}');
    } catch (err) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end('{"error":{"code":"internal","message":"Server error"}}');
    }
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT) || 3001;
  createServer().listen(port, () => console.log(`Backend server running at http://localhost:${port}`));
}
