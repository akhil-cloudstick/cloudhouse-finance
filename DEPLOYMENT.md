# Deployment / Docker setup (Cloudhouse-develop branch)

This file exists because the `Cloudhouse-test` branch (and possibly other
branches) does not have the Docker/deploy files below. If you switch to a
branch that's missing them, copy this file plus `docker-compose.yml`,
`backend/Dockerfile`, and `frontend/Dockerfile` back over before trying to
build/run there.

## Architecture: 4 Docker Compose services

Defined in `docker-compose.yml` (project name `golddemo`), all on one
dedicated bridge network `golddemo_network` (pinned to `172.31.0.0/16`
because this host's CSF firewall allowlists app subnets by IP — see
`/etc/csf/csfpost.sh` on the host, not in this repo).

1. **`golddemo_db`** — `postgres:15`. Persists to volume `golddemo_db_pgdata`.
   Healthcheck via `pg_isready`. Internal-only (no host port).
2. **`golddemo_frontend`** — builds from `frontend/Dockerfile`. Build-only
   job: runs `npm ci && npm run build` (Next.js static export), copies the
   `out/` directory into shared volume `golddemo_frontend_out`, then exits.
   No long-running server — the static export has nothing to serve itself.
3. **`golddemo_migrate`** — builds from `backend/Dockerfile`, runs
   `./migrate` (idempotent: AutoMigrate + backfills + seeds default admin if
   none exists), then exits. Waits for `golddemo_db` to be healthy.
4. **`golddemo_backend`** — builds from `backend/Dockerfile`, runs `./server`
   (the actual Go API + static file server). Waits for `golddemo_db`
   healthy, `golddemo_frontend` to finish, and `golddemo_migrate` to finish.
   Mounts `golddemo_frontend_out` read-only at `/app/frontend/out` and a
   separate `golddemo_uploads` volume at `/app/uploads`. **Only container
   bound to the host**, on `127.0.0.1:6789` — matches the CloudStick panel's
   nginx vhost for this app (`/etc/nginx-cs/vhosts.d/gold-app-demo.d/proxy.conf`,
   lives on the host, not in this repo) which proxies
   `golddemo.cloudhousefinance.com` → `http://127.0.0.1:6789`.

## Dockerfiles

- **`backend/Dockerfile`** — multi-stage: `golang:1.26-alpine` builder
  compiles `server` and `cmd/migrate` (CGO disabled, linux/amd64), then
  copies both binaries + `templates/` into a `debian:bookworm-slim` runtime
  image with `chromium` installed (needed because `chromedp` renders the
  loan indemnity bond PDF — see `internal/platform/setu_esign.go`,
  `internal/loan/indemnitybond.go`). Exposes `6789`, `CMD ["./server"]`.
- **`frontend/Dockerfile`** — `node:20-alpine`, `npm ci`, `npm run build`,
  then copies `out/` to `/shared-out` and exits. Not a server image.

## Env files

- **Server: no `.env`.** All server config for both backend and frontend
  lives in `docker-compose.yml` (backend `environment:`, frontend build
  `args:`), so a clone shows exactly what production runs with, including
  the secrets (`DB_PASSWORD`, `JWT_SECRET`, `SETTINGS_ENCRYPTION_KEY`,
  `AADHAAR_ENCRYPTION_KEY`) — never change the JWT secret or encryption keys
  on a live server (users get logged out / encrypted data becomes unreadable).
- **Local development: `.env`.** The backend loads `backend/.env` (godotenv)
  and `next dev` loads `frontend/.env*`; both are gitignored.
- **`backend/.env.example`** — full documented template of every backend env
  var (DB connection, encryption keys, JWT, SMTP, Twilio, Setu PAN/
  DigiLocker/eSign, Cashfree, Razorpay, OpenWA integration, RLS setup SQL).
  Safe to copy as-is; fill in real values for a real deployment.
- **`frontend/.env.example`** — `BACKEND_ORIGIN` and `NEXT_PUBLIC_API_BASE`,
  both normally left unset for the standard single-origin setup (Go binary
  serves both API and the built frontend).

## How to build & run

```bash
cd gold-app
docker compose build
docker compose up -d
docker compose logs -f golddemo_backend   # watch it come up
```

`golddemo_migrate` and `golddemo_frontend` run once per `up` and exit 0 on
success (that's expected — they're one-shot jobs, not crash-looping
services). `golddemo_backend` is the only one that stays running.

## Things that live outside this repo (won't come with a branch switch)

- The nginx vhost config: `/etc/nginx-cs/vhosts.d/gold-app-demo.d/proxy.conf`
  on the host, proxying `golddemo.cloudhousefinance.com` → `127.0.0.1:6789`.
- The CSF firewall allowlist entry for the `172.31.0.0/16` subnet in
  `/etc/csf/csfpost.sh`.

If these are already in place on the host, they don't need to be redone when
switching branches locally — only the in-repo Docker files matter for that.

## Git note (as of 2026-09-19)

Branch `Cloudhouse-develop` is clean and 20 commits ahead of
`origin/Cloudhouse-develop` (nothing pushed yet), remote `origin` →
`https://gitlab.com/susmithams1993/gold-app.git`. This includes the commit
that added the current `docker-compose.yml`. Unpushed commits do **not**
block switching branches locally (branches and push state are independent,
and the working tree is clean so a plain `git checkout <branch>` is safe).
They do matter later though: these Docker/deploy files only exist on this
branch's local history until they're pushed or cherry-picked elsewhere — if
`Cloudhouse-test` is meant to get them permanently, that'll need an explicit
push/merge/cherry-pick step at some point.
