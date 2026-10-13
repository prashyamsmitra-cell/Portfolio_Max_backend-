# Portfolio Backend API

Standalone, serverless backend for the portfolio application.

Provides REST API endpoints for:
- **Curated GitHub metadata proxy** (`/api/github`) with rate-limit mitigation and caching.
- **Journal / Posts management** (`/api/posts`): public reading of published articles, admin listing, creation, editing, publishing/unpublishing, and deletion.
- **Admin authentication gate** (`/api/admin-login`): verified against Supabase Auth (or local dev HMAC tokens) and an explicit `ADMIN_EMAILS` whitelist.
- **Photo upload endpoint** (`/api/upload`): image validation via magic-bytes (PNG, JPEG, WebP) and storage in Supabase Storage `post-covers` bucket (or local filesystem in dev mode).
- **Cross-Origin Resource Sharing (CORS)**: preflight `OPTIONS` handling, explicit origin allow-list validation, and `Cross-Origin-Resource-Policy: cross-origin` headers.

No runtime npm dependencies. Runs on Node.js 20+.

---

## Directory Structure

```
portfolio-backend/
├── api/
│   ├── admin-login.js           # POST /api/admin-login
│   ├── github.js                # GET /api/github
│   ├── posts.js                 # GET, POST, PATCH, DELETE /api/posts
│   ├── upload.js                # POST /api/upload
│   └── _lib/
│       ├── auth.js              # Token verification & ADMIN_EMAILS whitelist
│       ├── http.js              # CORS handling, preflight OPTIONS, security headers
│       ├── store.js             # Dual store: Supabase in prod, data/posts.json in dev
│       ├── supabase.js          # Supabase REST client (PostgREST, Auth, Storage)
│       └── validate.js          # Input validation & schema sanitization
├── data/
│   └── posts.json               # Local development fallback post store
├── scripts/
│   ├── dev.mjs                  # Zero-dependency local server (port 3001)
│   ├── watch.mjs                # File watcher restarting dev.mjs on changes
│   ├── test-api.mjs             # 28 HTTP and CORS tests (in-memory stubs)
│   └── seed-posts.mjs           # One-off database seeder
├── supabase/
│   ├── schema.sql               # Base tables, triggers, RLS, and storage buckets
│   └── migrations/              # Incremental SQL migrations
├── uploads/                     # Local file upload directory (.gitkeep)
├── .env.example                 # Environment variables documentation
├── .gitignore                   # Ignores .env, node_modules, local uploads
├── package.json                 # Scripts and devDependencies
└── vercel.json                  # Serverless route protection and security headers
```

---

## Environment Variables

Copy `.env.example` to `.env` for local development:
```bash
cp .env.example .env
```

All variables are **server-side only** and must never be exposed to the browser.

| Name | Required | Purpose |
|---|---|---|
| `ALLOWED_ORIGINS` | No | Comma-separated list of allowed frontend origins (e.g. `http://localhost:3000,https://my-portfolio.vercel.app`). Defaults to localhost origins (`http://localhost:3000`, `http://localhost:5000`) if unset. |
| `PORT` | No | Local server port (defaults to `3001`). |
| `GITHUB_USERNAME` | No | GitHub account to query (defaults to `prashyamsmitra-cell`). |
| `GITHUB_TOKEN` | No | Optional GitHub PAT. Raises API rate limit from 60/hr to 5,000/hr. |
| `SUPABASE_URL` | Prod | Supabase project URL (`https://YOUR-PROJECT.supabase.co`). |
| `SUPABASE_ANON_KEY` | Prod | Anon key; used server-side only to verify user credentials with Supabase Auth. |
| `SUPABASE_SERVICE_ROLE_KEY` | Prod | Service-role key. Bypasses RLS for admin DB and Storage operations. **Never commit or expose.** |
| `ADMIN_EMAILS` | Prod | Comma-separated email allow-list. Only matching emails receive admin tokens. Fail closed (empty = nobody can write). |
| `ADMIN_PASSWORD` | Local only | Optional password accepted by `/api/admin-login` during local dev when Supabase is unconfigured. |
| `ADMIN_SESSION_SECRET` | Local only | HMAC secret key used to sign local dev tokens. Defaults to a dev string if unset. |

---

## Local Development

1. Install development dependencies (chokidar for auto-restarting):
   ```bash
   npm install
   ```

2. Start the development server with auto-reload:
   ```bash
   npm run dev
   ```
   The backend runs at `http://localhost:3001`.

3. Alternatively, run without the watcher:
   ```bash
   npm run serve
   ```

4. Run the automated test suite:
   ```bash
   npm test
   ```
   Executes 28 tests covering public reads, admin CRUD, authentication, file uploads, GitHub rate-limiting, and CORS origin verification.

---

## CORS Configuration

When deployed separately from the frontend, browser security requires cross-origin access configuration:
- The backend inspects incoming `Origin` headers against `ALLOWED_ORIGINS`.
- If matched, it responds with:
  - `Access-Control-Allow-Origin: <matched-origin>`
  - `Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS`
  - `Access-Control-Allow-Headers: Content-Type, Authorization, Accept`
  - `Access-Control-Max-Age: 86400`
  - `Vary: Origin`
  - `Cross-Origin-Resource-Policy: cross-origin`
- Preflight `OPTIONS` requests are handled automatically with HTTP `204 No Content`.
- Unapproved origins receive standard responses without `Access-Control-Allow-Origin`, preventing unauthorized cross-origin reading.

---

## Supabase Database Setup

1. Open your Supabase project dashboard.
2. In the **SQL Editor**, run `supabase/schema.sql`. This sets up:
   - The `posts` table with constraints and triggers.
   - Row Level Security (RLS) policies allowing public reads for published posts only.
   - The public `post-covers` storage bucket.
3. If upgrading an existing database, run any migrations in `supabase/migrations/` (e.g. `002-linkedin-integration.sql`).
4. In **Authentication → Users**, add your admin email and password and confirm the email.
5. Set `ADMIN_EMAILS` in your backend deployment to include this email address.

---

## Deployment (Vercel)

1. Create a new project in Vercel pointing to the `portfolio-backend` repository.
2. Under **Project Settings → Environment Variables**, add the production variables listed above (`ALLOWED_ORIGINS`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_EMAILS`, `GITHUB_TOKEN`, etc.).
3. Deploy. Vercel automatically deploys each file under `api/*.js` as an edge/serverless function.
4. Note your deployed URL (e.g. `https://portfolio-backend.vercel.app`) to configure in the frontend.
