# Portfolio Backend API

Standalone, serverless backend for the portfolio application.

Provides REST API endpoints for:
- **Curated GitHub metadata proxy** (`/api/github`) with rate-limit mitigation and caching.
- **Journal / Posts management** (`/api/posts`): public reading of published articles, admin listing, creation, editing, publishing/unpublishing, and deletion.
- **Admin authentication gate** (`/api/admin-login`): verified against Supabase Auth (or local dev HMAC tokens) and an explicit `ADMIN_EMAILS` whitelist.
- **Photo upload endpoint** (`/api/upload`): image validation via magic-bytes (PNG, JPEG, WebP) and storage in Supabase Storage `post-covers` bucket (or local filesystem in dev mode).
- **Cross-Origin Resource Sharing (CORS)**: preflight `OPTIONS` handling, explicit origin allow-list validation, and `Cross-Origin-Resource-Policy: cross-origin` headers.

Uses Node.js built-ins plus Nodemailer for SMTP contact email. Runs on Node.js 20+.

---

## Directory Structure

```
portfolio-backend/
├── api/
│   ├── admin-login.js           # POST /api/admin-login
│   ├── contact.js               # POST /api/contact (SMTP enquiry + confirmation)
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
│   ├── dev.mjs                  # HTTP server handlers (port 3001)
│   ├── local-server.mjs         # Local server with JSON-file writes and local admin auth
│   ├── start.mjs                # Production server (local writes and auth disabled)
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
| `SMTP_HOST` | Contact form | SMTP server hostname (Gmail: `smtp.gmail.com`). |
| `SMTP_PORT` | Contact form | SMTP port (Gmail SSL: `465`, STARTTLS: `587`). Defaults to `465`. |
| `SMTP_SECURE` | Contact form | `true` for implicit TLS (port 465); `false` for STARTTLS (port 587). |
| `SMTP_USER` | Contact form | SMTP account username / sending address. |
| `SMTP_PASS` | Contact form | SMTP password or provider app password. Keep it secret. |
| `CONTACT_EMAIL` | Contact form | Inbox that receives visitor enquiries. |
| `SMTP_FROM` | No | Optional approved sender address; defaults to `SMTP_USER`. |

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
   npm run serve:local
   ```

4. Run the automated test suite:
   ```bash
   npm test
   ```
   Runs HTTP-level tests for public reads, admin CRUD, authentication, uploads, GitHub rate-limiting, SMTP contact mail, and CORS.

The public contact endpoint sends the enquiry to `CONTACT_EMAIL` and a confirmation to the visitor using SMTP. It does not use Supabase. For Gmail, enable 2-Step Verification and create an App Password for `SMTP_PASS`; do not use your regular Google password. The endpoint limits each IP to five requests per hour and rejects invalid or oversized submissions.

The production `npm run serve` command explicitly disables the local JSON post store and local admin sign-in. Use `npm run dev` or `npm run serve:local` only for local development.

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

## Deployment

### Render Web Service

For a repository containing both the frontend and backend, set the Render service root directory to `portfolio-backend`.

1. Set the **Build Command** to `npm ci`.
2. Set the **Start Command** to `npm run serve`.
3. Add the required service environment variables in Render. Set `ALLOWED_ORIGINS` to the exact deployed frontend origin, and configure the SMTP variables to enable contact messages.

### Vercel

1. Create a new project in Vercel pointing to the `portfolio-backend` repository.
2. Under **Project Settings → Environment Variables**, add the production variables listed above (`ALLOWED_ORIGINS`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_EMAILS`, `GITHUB_TOKEN`, etc.).
3. Deploy. Vercel automatically deploys each file under `api/*.js` as an edge/serverless function.
4. Note your deployed URL (e.g. `https://portfolio-backend.vercel.app`) to configure in the frontend.
