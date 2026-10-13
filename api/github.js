// GET /api/github — curated, cached proxy for public GitHub repo metadata.
// The optional GITHUB_TOKEN stays server-side (raises the rate limit; never sent to the browser).
import { allow, send, fail, route, httpError } from './_lib/http.js';

const USER_RE = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;
const TTL = 15 * 60 * 1000;
let cache = null; // { at, key, data } — per warm instance; the CDN cache does the heavy lifting

async function gh(path) {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'portfolio-site', 'X-GitHub-Api-Version': '2022-11-28' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  let res;
  try { res = await fetch(`https://api.github.com${path}`, { headers, signal: AbortSignal.timeout(8000) }); }
  catch { throw httpError(502, 'github_unreachable', 'GitHub is unreachable'); }
  if (res.status === 403 || res.status === 429) throw httpError(502, 'github_rate_limited', 'GitHub rate limit reached');
  if (res.status === 404) throw httpError(404, 'github_user_not_found', 'GitHub user not found');
  if (!res.ok) throw httpError(502, 'github_error', 'GitHub request failed');
  return res.json();
}

const shape = r => ({
  name: r.name, fullName: r.full_name, description: r.description, url: r.html_url,
  homepage: r.homepage || null, language: r.language, stars: r.stargazers_count, forks: r.forks_count,
  topics: Array.isArray(r.topics) ? r.topics : [], pushedAt: r.pushed_at, createdAt: r.created_at,
  fork: !!r.fork, archived: !!r.archived,
});

async function load(user, includeForks) {
  const [profile, repos] = await Promise.all([
    gh(`/users/${user}`),
    gh(`/users/${user}/repos?per_page=100&sort=pushed&type=owner`),
  ]);
  const list = repos.map(shape).filter(r => !r.archived && (includeForks || !r.fork));
  const languages = {};
  for (const r of list) if (r.language) languages[r.language] = (languages[r.language] || 0) + 1;
  return {
    user: { login: profile.login, url: profile.html_url, publicRepos: profile.public_repos, followers: profile.followers },
    totals: {
      repos: list.length,
      stars: list.reduce((n, r) => n + r.stars, 0),
      lastPush: list.reduce((m, r) => (r.pushedAt > m ? r.pushedAt : m), ''),
    },
    languages, // repo count per primary language
    repos: list,
  };
}

export default route(async (req, res) => {
  if (!allow(req, res, ['GET'])) return;
  const url = new URL(req.url, 'http://x');
  const user = process.env.GITHUB_USERNAME || 'prashyamsmitra-cell';
  if (!USER_RE.test(user)) return fail(res, 500, 'not_configured', 'Invalid GitHub username configured');
  const includeForks = url.searchParams.get('forks') === '1';
  const key = `${user}:${includeForks}`;

  let data, stale = false;
  if (cache && cache.key === key && Date.now() - cache.at < TTL) data = cache.data;
  else {
    try { data = await load(user, includeForks); cache = { at: Date.now(), key, data }; }
    catch (err) {
      if (cache && cache.key === key) { data = cache.data; stale = true; } // serve stale rather than fail
      else throw err;
    }
  }
  send(res, 200, { ...data, stale, fetchedAt: new Date(cache?.at || Date.now()).toISOString() },
    { 'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=86400' });
});
