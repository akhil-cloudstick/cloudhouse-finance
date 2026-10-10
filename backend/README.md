# Backend setup

## Requirements
- **Go 1.26** or later (bumped from 1.25 to add `github.com/chromedp/chromedp`
  for the indemnity-bond Aadhaar eSign feature — see below). Check with
  `go version`; if you're on an older Go, install/switch first
  (https://go.dev/dl/), or just run any `go` command here once network
  access is available and Go's toolchain auto-switch will fetch 1.26 for you.
- **PostgreSQL**, reachable with the `DB_*` values in `.env` (see
  `.env.example`).
- **Chrome or Chromium** installed and on `PATH` — required only for the
  indemnity-bond eSign flow (see below). Everything else in the backend
  runs fine without it.

## Installing dependencies
From `backend/`:

```bash
go mod download
```

(`go mod tidy` also works and additionally prunes anything unused.) This
pulls in every module listed in `go.mod`/`go.sum`, including `chromedp`.

## Indemnity bond eSign (Chrome/Chromium requirement)

`modules/Loan/controllers/indemnity_bond.go` renders the indemnity bond to PDF via a
**headless Chromium tab**, driven server-side by `chromedp`
(`config/surepass_client.go` then uploads that PDF to Setu and starts
an Aadhaar eSign request). This was chosen over a pure-Go PDF library
because Devanagari/Gujarati text (the bond's Hindi/Gujarati variants) needs
real text shaping (matra reordering, conjunct consonants) that a bare Go PDF
library doesn't provide — Chromium's own font/shaping engine handles it
correctly, the same way it does when staff print the bond from the browser
today.

This means **every machine that runs this backend — local dev and the
production host — needs a Chrome or Chromium binary installed**, separate
from `go mod download`. `chromedp` looks for one on `PATH` (or a few common
install locations) and returns a clear error if none is found; it does not
bundle or download a browser itself.

- **Windows/macOS dev machines:** a regular Google Chrome or Microsoft Edge
  install is usually enough — `chromedp` can find either.
- **Linux/production servers:** install a headless-friendly build, e.g. on
  Debian/Ubuntu:
  ```bash
  apt-get update && apt-get install -y chromium
  ```
  or use the `chromium-browser` / `google-chrome-stable` package your
  distro provides.
- If the backend runs in a container, the browser must be installed **in
  that image** — it does not exist inside a slim Go base image by default.

Nothing else in the app depends on Chrome being present — every other
endpoint works normally if it's missing, and only the eSign start endpoint
(`POST /loans/:id/indemnity-bond/esign/start`) will fail until it's
installed.
