# CloudHouse Gold Finance

Admin/management web app prototype for a gold-loan (pawnbroking) finance
business. See [documents/project_overview.md](documents/project_overview.md)
for full background.

> **Status:** frontend-only prototype. There is no backend API, database, or
> real authentication yet — see [documents/architecture.md](documents/architecture.md).

## Project structure
```
gold-app/
├── backend/
│   └── server.mjs        # Node.js static file server (no framework/deps)
├── frontend/
│   ├── index.html         # Customer/staff sign-in page
│   ├── app.html            # Admin SPA shell
│   ├── app.css              # Styling
│   ├── app.js                # SPA router + all page logic
│   ├── data.js                # Mock data layer (window.DB, localStorage-backed)
│   ├── qrcode.min.js           # Vendored QR code library
│   └── cloudhouse-gold.jpeg         # Logo
└── documents/
    ├── project_overview.md
    ├── architecture.md
    ├── database_architecture.md
    ├── api_documentation.md
    ├── context.md
    └── change_log.md
```

## Requirements
- [Node.js](https://nodejs.org/) 18+ (uses only built-in `node:http`,
  `node:fs`, `node:path`, `node:url` modules — no npm install required).

## Setup
1. Clone/download the repository.
2. No dependency installation is needed — the backend has zero npm
   dependencies and the frontend is plain static HTML/CSS/JS with no build
   step.

## Running the app
From the repository root:

```bash
node backend/server.mjs
```

By default the server listens on **port 8090**. Then open:

```
http://localhost:8090/
```

- `http://localhost:8090/` or `/index.html` → sign-in page
- `http://localhost:8090/app.html` → admin dashboard SPA (any unmatched
  route falls back to `app.html`/`index.html` via SPA-style routing)

### Changing the port
Set the `PORT` environment variable before starting the server:

```bash
# macOS/Linux
PORT=4000 node backend/server.mjs

# Windows PowerShell
$env:PORT=4000; node backend/server.mjs
```

## Data & persistence
All application data (customers, loans, gold rates, packets, ledgers, etc.)
is mock data defined in [frontend/data.js](frontend/data.js) and persisted
to the browser's `localStorage`. This means:
- Data is **per-browser**, not shared across users or devices.
- Clearing browser storage resets the app to its seeded defaults.
- There is currently no server-side database — see
  [documents/database_architecture.md](documents/database_architecture.md)
  for the data model to migrate to a real database.

## Authentication
The sign-in page (`frontend/index.html`) validates input client-side only.
There is no real authentication/authorization wired up yet.

## Documentation
Full documentation lives in [documents/](documents/):
- [project_overview.md](documents/project_overview.md) — what the app is and does
- [architecture.md](documents/architecture.md) — technical architecture
- [database_architecture.md](documents/database_architecture.md) — data model
- [api_documentation.md](documents/api_documentation.md) — current (none) and planned API
- [context.md](documents/context.md) — business/domain context and terminology
- [change_log.md](documents/change_log.md) — history of changes

## Roadmap / known gaps
- [ ] Real backend framework + REST/GraphQL API
- [ ] Persistent shared database (replacing `localStorage` mock)
- [ ] Real authentication & authorization
- [ ] `package.json` with scripts (`start`, `dev`, etc.)
- [ ] Build tooling, if the frontend adopts a framework
