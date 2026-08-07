# Change Log

All notable changes to this project are documented here. This log reflects
the actual git history at the time of writing; update it as new commits land.

## [Unreleased]
### Added
- Go backend domains: **Gold Rates** (`backend/internal/goldrate/`),
  **Employees** (`backend/internal/employee/`), and **Cash Movements +
  Expenses** (`backend/internal/cash/`) — Gin + GORM + PostgreSQL,
  following the same vertical-slice pattern (`model`/`repository`/
  `service`/`handler`/`routes`) as the existing `internal/scheme` module.
  Wired into `cmd/api/main.go` and `cmd/migrate/main.go`. No
  authentication/RBAC yet and not wired to the frontend yet — verified
  independently end-to-end via curl (create/list/get, plus gold-rates'
  `/latest` and cash-movements' status-toggle endpoints), per
  `architecture.md`'s sequencing note. See `api_documentation.md` and
  `database_architecture.md` for the new endpoints/tables.

### Changed
- Restructured project from a flat root layout (`public/`, `server.mjs`) into
  a `backend/` + `frontend/` directory split.
  - Removed (root, uncommitted at time of writing): `server.mjs`,
    `public/index.html`, `public/app.html`, `public/app.js`,
    `public/app.css`, `public/data.js`, `public/qrcode.min.js`,
    `public/ambika-gold.jpeg`.
  - Added: `backend/` (Node.js static file server), `frontend/` (all
    former `public/` assets, moved and renamed conceptually as the SPA).
- Added `documents/` folder with project documentation (this file,
  `project_overview.md`, `architecture.md`, `database_architecture.md`,
  `api_documentation.md`, `context.md`) and a root `README.md`.

## 2026-08-07 (approx.) — a729d6a — Initial commit: gold app
- Initial commit of the Ambika Gold Finance prototype.
- Static customer sign-in page (`index.html`) and admin SPA (`app.html`,
  `app.js`, `app.css`) with a hash-based client-side router.
- Mock data layer (`data.js`) backing all app screens via `window.DB`,
  persisted to `localStorage`.
- Modules covered: Dashboard, Customers, Loans, Schemes, Gold Rates,
  Packets & Lockers, Cash & Expenses, Calendar, Requests/Approvals,
  Bank Re-Pledge, Auctions, Reports, Employees.
- Basic Node.js static file server (`server.mjs`) to serve the frontend.
- No backend API, no database, no real authentication yet.

---
*Format loosely follows [Keep a Changelog](https://keepachangelog.com/).
Since there is no `package.json`/version number yet, entries are grouped by
commit/date rather than semantic version until versioning is introduced.*
