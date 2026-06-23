# Shard Cloud — Ops Runbook (internal)

How to deploy and operate **bero-royale** (and manage infra) on **Shard Cloud** via its REST API.
Any agent: read this before touching production. Docs: https://docs.shardcloud.app/ ·
LLM dump: https://docs.shardcloud.app/llms-full.txt · OpenAPI: https://docs.shardcloud.app/api-reference/openapi.json

## ✅ Live deployment (2026-06-16) — single Node app
- **App:** Bero Royale — **https://beroroyale.shardweb.app** · app id `8e2d4cd7-7167-4199-82a0-67db193cbe79` · subdomain `beroroyale` · **LANGUAGE=node** · status running.
  - ONE Node process (Elysia + the `ws` lib + postgres.js) that serves the built Vite SPA **and** the backend: realtime multiplayer + WebRTC voice signaling over WebSocket (`/ws`), persistent leaderboard REST (`/api/leaderboard`, `/api/score`), and the SPA static files (with `/play` deep-link fallback). **No Supabase.**
  - Source: client at repo root (Vite), server in `server/` (pnpm workspace). Build: `pnpm build:deploy` → `pnpm stage` → zip `deploy/` → deploy. See `docs/sprints.md`? No — see the recipe below.
- **DB:** Postgres `bero-royale-db` — id `23b33eb2-3291-4bad-ae5f-903f55e03ba5`, 1024MB. `DATABASE_URL` lives server-side only (in `.env` for local, injected via the app's `CUSTOM_COMMAND` in prod), NEVER in the client bundle. The server now USES it (leaderboard table).
- **Redeploy:** `pnpm build:deploy && pnpm stage && ( cd deploy && zip -rq ../bero-royale.zip . -x '*.DS_Store' )` then `PUT /apps/8e2d4cd7-7167-4199-82a0-67db193cbe79/file` with `-F "project=@bero-royale.zip;type=application/zip"`, then POST `/status {restart}`.

### ⚠️ Hard-won node-deploy gotchas (cost real debugging — keep these)
1. **`LANGUAGE` is immutable after create.** `PUT /file` updates files + `CUSTOM_COMMAND` but does NOT switch a `static` app to `node`. To change language you must `DELETE /apps/{id}` and `POST /apps` fresh (the subdomain frees up for immediate reuse). That is why the app id changed from the old static `cb317ee6…` to `8e2d4cd7…`.
2. **Listen with `server.listen(PORT)` — NO hostname.** Passing `"0.0.0.0"` binds IPv4-only; the Shard Cloud edge proxies to the container over **IPv6**, so an IPv4-only bind → permanent `502 Bad Gateway` even though logs say "listening". `server.listen(PORT)` binds dual-stack `::`. (Matches the platform's other working node apps.)
3. **`PORT` is injected (we saw `PORT=80`).** Use `Number(process.env.PORT) || 3000`. Don't hardcode.
4. **Don't rely on `@elysiajs/node`'s `.listen()` to expose the raw server.** Its `app.server.raw.node.server` was unbound (`.address()===null`) → 502. We create our own `http.createServer`, bridge requests to Elysia via `app.handle(Request)`, attach `ws` to that server, and `listen()` ourselves.
5. **`@elysiajs/node` registers a crossws `"upgrade"` listener** that races a hand-rolled `ws` server and closes freshly-upgraded sockets. We `server.removeAllListeners("upgrade")` before adding ours (we don't use Elysia `.ws()`).
6. **`@elysiajs/static` didn't serve under the node adapter** → replaced with a small manual static handler (`server/src/static.ts`).
7. **ESM bundle + CJS deps:** tsup `banner` injects `createRequire` so bundled CJS deps (dotenv) that call `require("fs")` work ("Dynamic require not supported" otherwise).

> NOTE on the live URL: free subdomains are served on **`<subdomain>.shardweb.app`** (NOT `shardcloud.app`, which is only the API/dashboard host). Databases are reached at `*.shardatabases.app`.

## Auth
- **API base:** `https://shardcloud.app/api`
- **Header:** `Authorization: Bearer $SHARDCLOUD_API_KEY`
- The key lives in the gitignored **`.env`** (`SHARDCLOUD_API_KEY`). Load it: `set -a; . ./.env; set +a` (or `KEY=$(grep ^SHARDCLOUD_API_KEY .env | cut -d= -f2)`).
- There is **no** documented `whoami`. Verify the key with a read-only `GET /apps` (200 = good).

## Endpoint reference (verified against the live OpenAPI)
**Apps**
- `GET /apps` — list all apps (+ live status/metrics). Use to find an app's `id` + `subdomain`.
- `POST /apps` — **create app**. `multipart/form-data`, field `project` = a **ZIP of the build** (≤100 MB). The file part MUST be sent as `type=application/zip` (curl: `-F "project=@out.zip;type=application/zip"`), else `400 invalid content type`. Returns `{ "id": "<uuid>" }`.
- `GET /apps/{id}` · `DELETE /apps/{id}`
- `PUT /apps/{id}/file` — **redeploy / update code** (same multipart ZIP as create). Returns `{message}`.
- `POST /apps/{id}/files` `{path,content}` (json) — create one file · `PATCH` move · `DELETE` remove · `GET /apps/{id}/files` tree · `GET /apps/{id}/file/content` read.
- `POST /apps/{id}/status` `{status:"run"|"stop"|"restart"}` · `GET /apps/{id}/status`.
- `PUT /apps/{id}/resources` — change RAM/vCPU.
- `GET /apps/{id}/deploys` · `GET /apps/{id}/metrics` · `GET /apps/{id}/logs` (SSE).
- Domains: `GET/POST/DELETE /apps/{id}/domain`, `DELETE /apps/{id}/domain/cache`.
- Deploy tokens (CI): `GET/POST/DELETE /apps/{id}/deploy-token`.

**Databases**
- `GET /databases` — list. `POST /databases` `{type:"postgres"|"mongo"|"redis", ram:int≥512, password:str, name:str, visualizer?:bool}` → returns `{message}` (NOT an id — re-`GET /databases` and match by `name` to get the id).
- `GET /databases/{id}/connection-url` → `{connection_url, visualizer_url?}`. Hostnames look like `postgres.shardatabases.app:5432`.
- `GET /databases/{id}` · `DELETE` · `POST /{id}/stop` · `POST /{id}/initialize` · `POST /{id}/retry-setup` · `PUT /{id}/resources` · `PUT /{id}/password` · `GET /{id}/metrics` · `GET /{id}/status`.

**CDN:** `GET/POST/DELETE /cdn/...` (file delivery) — see docs `/cdn`.

## Env vars (important — there is NO env-var API endpoint)
- **Backend apps** (node/go/etc): env vars are baked into the **run command**. The `.shardcloud` `START`/run command is prefixed with `VAR=value` inline. Real example from this account's `Terminal Hack` app: `custom_command = "DATABASE_URL='postgres://…' PGSSL=true node server.js"`. So to give an app a `DATABASE_URL`, put it in the start command (or set it in the dashboard → it ends up there).
- ⚠️ `VITE_*` build-time vars (if any) are inlined into the **public client bundle** by Vite. Never
  put a database connection string or any secret in a `VITE_*` var. Server secrets (e.g.
  `DATABASE_URL`) live in the **run command**, not in the bundle — see below.

> ⛔️ **HISTORICAL (no longer true):** this app was once deployed as a **static NGINX site**
> (`LANGUAGE=static`, `MAIN=index.html`, `pnpm build` → `dist/`). It is now a **single Node app**
> (see the top of this doc). The static `.shardcloud` config and the static-SPA deploy recipe were
> removed because they contradicted the Node deployment. The accurate Node recipe is below.

## `.shardcloud` / `deploy.shardcloud` config (Node app)
The committed template is **`deploy.shardcloud`** at repo root; `pnpm stage` runs
`scripts/gen-shardcloud.mjs` to inject the secret `DATABASE_URL` from the gitignored `.env` and
write `deploy/.shardcloud` (gitignored). Template:
```
DISPLAY_NAME=Bero Royale
DESCRIPTION=Bero Royale backend — Vite SPA + WebSocket multiplayer/voice + Postgres leaderboard
LANGUAGE=node                 # immutable after create (see gotcha #1 above)
MEMORY=1024
VERSION=recommended
SUBDOMAIN=beroroyale
CUSTOM_COMMAND=DATABASE_URL='__DATABASE_URL__' PGSSL=true NODE_ENV=production node server.js
```
`gen-shardcloud.mjs` also writes a minimal `deploy/package.json` (`type: module`, `main: server.js`)
— the tsup bundle inlines every dependency, so the container needs **no install step**. Guard: the
`CUSTOM_COMMAND` is capped at 250 chars. Languages: `static` (nginx), `node`, `go`, `python`,
`java`, `csharp`, `php`. Single datacenter: Ashburn, VA.

## Deploy recipe for bero-royale (Node app)
```bash
pnpm build:deploy   # build:prod (client → dist/) + copy:spa (dist → server/public) + build:server (tsup)
pnpm stage          # assembles deploy/: server.js + public/ + injected .shardcloud + package.json
( cd deploy && zip -rq ../bero-royale.zip . -x '*.DS_Store' )
KEY=$(grep ^SHARDCLOUD_API_KEY .env | cut -d= -f2)
# Redeploy (the app already exists — id 8e2d4cd7-… , see top of this doc):
curl -X PUT https://shardcloud.app/api/apps/8e2d4cd7-7167-4199-82a0-67db193cbe79/file \
  -H "Authorization: Bearer $KEY" -F "project=@bero-royale.zip;type=application/zip"
curl -X POST https://shardcloud.app/api/apps/8e2d4cd7-7167-4199-82a0-67db193cbe79/status \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -d '{"status":"restart"}'  # field is "status", not "action"
```
Live at **`https://beroroyale.shardweb.app`** (free `shardweb.app` subdomain, NOT `shardcloud.app`).
The Node server serves the SPA **and** handles the `/play` deep-link fallback (`server/src/static.ts`),
so refreshing a deep link works — no NGINX, no 404 caveat.

## Create the database (when capacity allows)
```bash
curl -X POST https://shardcloud.app/api/databases -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"type":"postgres","ram":1024,"password":"<gen>","name":"bero-royale-db"}'   # postgres needs ≥1024MB
KEY=...; curl -s https://shardcloud.app/api/databases -H "Authorization: Bearer $KEY"  # find the id by name
curl -s https://shardcloud.app/api/databases/<DB_ID>/connection-url -H "Authorization: Bearer $KEY"
# Store the connection_url server-side only (NOT in the client bundle): put it in .env as DATABASE_URL,
# and (for a backend app) in the app's run command.
```

## Limits (per docs/limits)
- Min RAM: app 256MB · website 512MB · postgres/mongo/mysql 1024MB · redis 512MB. Max app RAM 32GB.
- App storage flat 10GB. DB storage = `6 + RAM_MB/512` GB. DB max connections = `RAM_MB/8`.
- Bandwidth (Mbps) = `30 + (RAM_MB/256)*50`. Network/HTTP-request abuse caps stop a project for 1–24h.

## History: the 402 budget blocker (resolved 2026-06-16)
Earlier, `POST /apps` returned **402 `{"error":"user cannot create project"}`** — the account was **over its plan's RAM budget** (~37GB > 32GB max). It was resolved when the owner **freed capacity** (deleted an unused VPS), after which `POST /apps` and `POST /databases` both succeeded (201). Lesson: a 402 here means "no capacity / plan ceiling", not a malformed request — free capacity (`POST /apps/{id}/status {stop}` / `DELETE /databases/{id}`) or raise the plan. Never delete/stop production resources without the owner's explicit per-resource go-ahead.
