# Ambika Gold Finance — System Architecture

> **Status:** this document describes the **planned production architecture**
> (per the CloudHouse Gold Loan Management proposal). A real Go backend has
> now been started under `backend/` (Gin + GORM + PostgreSQL, db
> `ambikagold`) with four domain modules implemented end-to-end —
> `internal/scheme` (loan schemes), `internal/goldrate` (gold rates),
> `internal/employee` (employees), and `internal/cash` (cash movements +
> expenses); see [api_documentation.md](api_documentation.md) and
> [database_architecture.md](database_architecture.md) for what's live
> today. The Go binary (`cmd/api`) also now serves the built Next.js
> export (`frontend/out`) on the same port, via `internal/webstatic`,
> replacing `backend/server.mjs`'s role — the "single port, no reverse
> proxy" design below is realized, even though most domains behind it are
> still mock data. None of the four live domains are wired to the
> frontend yet (built and verified independently via curl first, per the
> Sequencing section below). All other domains listed below are still not
> started; the frontend remains a UI prototype against a mock data layer
> for everything except these four. See
> [project_overview.md](project_overview.md) for the full picture.

## Overview
Ambika Gold Finance is a single Go backend service, serving both the REST
API and the built admin web app on **one port**, consumed by two frontends:
a web admin dashboard and a customer-facing Android app. There is no
separate reverse proxy and no BFF layer — both frontends talk directly to
the same REST API.

```
                        ┌───────────────────────────────┐
                        │   backend/ (Go)                  │
                        │  REST API  /api/v1/*  :8080        │
                        │  Static frontend build  /*            │
                        │  JWT auth + RBAC                        │
                        └──────────────┬───────────────────────┘
                                        │ GORM
                                        ▼
                        ┌───────────────────────────────┐
                        │   PostgreSQL                      │
                        │   db: ambikagold                    │
                        └───────────────────────────────┘
                                        ▲
                        ┌───────────────┴──────────────┐
                        │                               │
                  ┌───────┴──────┐              ┌───────┴────────┐
                  │ frontend/     │              │ mobile/          │
                  │ admin (web)    │              │ (React Native,    │
                  │ Next.js — built  │              │  Android)           │
                  │ and served by      │              └─────────────────┘
                  │ the Go binary        │
                  └─────────────────────┘
```

## Components

### Backend (`backend/`)
Go application, one internal package per business domain (`auth`,
`customers`, `schemes`, `goldrate`, `loans`, `ornaments`, `packets`,
`lockers`, `ledger`, `cash`, `expenses`, `reminders`, `bankpledge`,
`auctions`, `employees`, `reports`, `audit`). Each package encapsulates its
own handler/service/repository; cross-domain logic goes through service
injection (e.g. `LoanService` calls `GoldRateService.Valuate()` at loan
creation), never handler-to-handler.

Data access goes through a thin repository layer using **GORM**
(`gorm.io/gorm` with the `gorm.io/driver/postgres` driver) against a single
PostgreSQL database (`ambikagold`). Model structs live alongside each
domain package (e.g. `internal/loan/model.go`) and GORM tags define
columns/constraints. See
[database_architecture.md](database_architecture.md) for schema detail.

The same Go binary also serves the built Next.js admin app as static
assets, with an SPA fallback to `index.html` for client-side routes —
the same pattern the current prototype's `backend/server.mjs` already
uses, just carried into the production Go server.

### Frontends
Both frontends are pure API consumers — no direct DB access, no duplicated
business logic:

- `frontend/` — web admin dashboard (Next.js/React + TypeScript), built and
  served as static assets by the Go backend on the same port.
- `mobile/` — React Native (Android) app for customers.

A shared package (e.g. `frontend/shared/` if the admin app and mobile app
share a monorepo tooling setup) can hold the API client, typed endpoint
functions, and the DTO/type contract used by both apps — to be confirmed
once the frontend workspace is set up.

## Data Flow
```
Client UI → API client (fetch/axios, Bearer token) → Go handler
   → Service (business logic) → GORM repository → PostgreSQL
   ← DTO/JSON response ← Service ← Handler
```

Background jobs (interest accrual, penal interest application, reminder
dispatch, auction eligibility checks) run as scheduled goroutines within
the same Go process (cron-style), writing through the same
service/repository layers as request-driven code — no separate worker
service in v1.

## Authentication
JWT-based auth (`golang-jwt/jwt` or similar) + RBAC. `POST /api/v1/auth/login`
validates credentials (and OTP, where applicable) and issues a JWT (subject,
role, branch, expiry). A global auth middleware protects all routes except
those explicitly marked public (e.g. `/auth/login`, `/auth/otp/verify`); a
roles middleware restricts sensitive routes (gold rate changes, scheme
modifications, payment reversals, waivers, auction confirmation) to
authorized roles.

Roles: `admin`, `management`, `branch_manager`, `loan_operator`, `cashier`,
`accountant`, `collection_staff`, `auction_admin`, `auditor`, `customer`.

Token storage differs per platform:
- **admin (web)** — httpOnly cookie or secure storage, per final decision
- **mobile (React Native)** — secure device storage (e.g. Keychain/Keystore
  via a library such as `react-native-keychain`)

## Database Migrations
Schema is defined as GORM model structs per domain package. Two migration
paths:
- **Local/dev** — GORM's `AutoMigrate()` run at startup (or via a small
  `cmd/migrate` tool) to keep dev databases in sync with model structs.
- **Production** — versioned migration files generated/tracked explicitly
  so schema changes are reviewable and repeatable across environments,
  rather than relying on `AutoMigrate` directly against production. Exact
  tooling (plain versioned SQL vs. a GORM-aware migration library) to be
  finalized when the backend module is scaffolded.

## File Uploads
Customer photos, KYC documents, and ornament/jewellery images are uploaded
via `multipart/form-data` to endpoints such as `POST /api/v1/customers/:id/kyc`
and `POST /api/v1/loans/:id/ornaments/:ornamentId/images`. Files are stored
in object storage (S3-compatible), not on local disk, given multi-branch
deployment and backup requirements; only the storage URL/reference is kept
in the database (`kyc_documents.file_url`, `ornament_images.image_url`).
See [context.md](context.md) for provider selection status.

## Folder Structure

### Current (as scaffolded today)
The `frontend/` folder has already been scaffolded as a real Next.js app
(migrated off the old flat HTML/JS prototype, which now lives under
`legacy/`). `backend/` now has a real Go module started, with four
domains implemented (`scheme`, `goldrate`, `employee`, `cash`) and the Go
binary itself serving the built frontend (see "Planned" tree below for
the full target shape — the actual tree today is a subset of it).
`server.mjs` still exists in the repo but is superseded — `cmd/api` now
serves `frontend/out` directly.

```
gold-app/
├── backend/
│   ├── server.mjs                    # superseded: legacy static file server (Node), kept for reference
│   ├── go.mod / go.sum
│   ├── .env.example
│   ├── cmd/
│   │   ├── api/main.go                # Go REST API + static frontend server bootstrap (:8080)
│   │   └── migrate/main.go            # standalone AutoMigrate runner
│   └── internal/
│       ├── platform/                  # config + GORM/postgres connection
│       ├── webstatic/                 # serves frontend/out (clean URLs, SPA-style), replaces server.mjs
│       ├── scheme/                    # loan scheme CRUD — implemented
│       │   ├── model.go
│       │   ├── repository.go
│       │   ├── service.go
│       │   ├── handler.go
│       │   └── routes.go
│       ├── goldrate/                  # daily gold rate publish + history — implemented
│       ├── employee/                  # staff CRUD — implemented
│       └── cash/                      # cash movements + expenses — implemented
│
├── documents/                        # project docs (this folder)
│   ├── project_overview.md
│   ├── architecture.md
│   ├── database_architecture.md
│   ├── api_documentation.md
│   ├── context.md
│   └── change_log.md
│
└── frontend/                         # Next.js web admin app
    ├── .next/                        # build output (generated)
    ├── app/                          # Next.js app-router routes
    ├── components/                   # shared UI components
    ├── hooks/
    │   └── useHashRoute.ts           # bridges old hash-based routing
    ├── legacy/                       # migrated-in prototype code
    ├── lib/                          # helpers/utilities
    ├── node_modules/                 # dependencies (generated)
    ├── out/                          # static export output (generated)
    ├── public/                       # static assets
    ├── .gitignore
    ├── AGENTS.md
    ├── CLAUDE.md
    ├── eslint.config.mjs
    ├── next-env.d.ts
    ├── next.config.ts
    ├── package.json
    ├── package-lock.json
    ├── README.md
    ├── tsconfig.json
    └── HANDOFF.md
```

### Planned (once the Go backend is built)
```
gold-app/
├── backend/                          # Go REST API + static frontend server
│   ├── cmd/
│   │   └── api/
│   │       └── main.go               # app bootstrap (:8080)
│   ├── internal/
│   │   ├── auth/                     # login, JWT, OTP, RBAC middleware
│   │   ├── customer/                 # registration, KYC, verification
│   │   ├── scheme/                   # loan scheme CRUD
│   │   ├── goldrate/                 # daily rate entry + history
│   │   ├── loan/                     # creation, valuation, approval workflow
│   │   ├── ornament/                 # ornament + purity testing + images
│   │   ├── packet/                   # packet/QR generation
│   │   ├── locker/                   # locker/vault management
│   │   ├── ledger/                   # payments, interest/penal calc (GORM models)
│   │   ├── cash/                     # cash-in-hand, expenses
│   │   ├── reminder/                 # calendar, SMS/WhatsApp dispatch
│   │   ├── bankpledge/               # re-pledge tracking
│   │   ├── auction/                  # auction workflow
│   │   ├── employee/                 # staff, roles, performance
│   │   ├── report/                   # aggregated report queries, exports
│   │   ├── audit/                    # audit log writer (used by all modules)
│   │   └── platform/                 # GORM/DB setup, config, middleware, ext. clients
│   ├── migrations/                   # versioned SQL / GORM migration files
│   └── go.mod
│
├── frontend/                         # web admin dashboard (Next.js) — as above,
│   │                                 # built and served as static assets by the
│   │                                 # Go backend on the same port
│   └── ... (see "Current" tree above)
│
├── mobile/                           # React Native (Android) customer app — not yet scaffolded
│   ├── src/
│   │   ├── screens/
│   │   ├── components/
│   │   ├── store/                    # auth/session state
│   │   └── lib/                      # API client (shares contract w/ web)
│   └── package.json
│
└── documents/                        # project docs — as above
```

## Sequencing
The backend (Go API + PostgreSQL schema) is built and verified end-to-end
(via Postman/curl) before the current frontend prototype is migrated off
its mock `data.js` layer. Migration then proceeds: API client setup →
admin web app wired to live endpoints → mobile app built against the same
API — tearing down mock data/local storage usage only once each screen is
confirmed against the live backend. See [context.md](context.md) and
[change_log.md](change_log.md) for status as this progresses.
