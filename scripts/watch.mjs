// Dev entry: runs scripts/dev.mjs and restarts it when server-side code changes.
// Usage: npm run dev   (reads .env if present; PORT defaults to 3001)
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import chokidar from 'chokidar';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
if (existsSync(join(root, '.env'))) {
  for (const line of readFileSync(join(root, '.env'), 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*([^#\n]*)/.exec(line);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim();
  }
}

const entry = join(root, 'scripts', 'dev.mjs');
let child = null;
let restarting = false;
let queued = null;
let timer = null;

const start = () => {
  child = spawn(process.execPath, [entry], { stdio: 'inherit', env: { ...process.env, DEV_SERVER: '1' } });
  child.on('exit', () => { child = null; });
  if (queued) { const file = queued; queued = null; restart(file); }
};

const restart = file => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (restarting) { queued = file; return; }
    if (!child) return start();
    restarting = true;
    console.log(`\nrestarting — ${file}`);
    child.once('exit', () => { restarting = false; start(); });
    child.kill();
  }, 120);
};

start();

chokidar
  .watch([join(root, 'api'), join(root, 'scripts')], { ignoreInitial: true })
  .on('all', (_event, file) => restart(file.slice(root.length + 1)));

const stop = () => { if (child) child.kill(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
