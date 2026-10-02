# Multi-Tenant Subdomain Setup Guide

## Overview

Right now, each tenant's URL (like `golddemo.cloudhousefinance.com`) has to be manually created — a DNS record and SSL certificate set up by hand for that one subdomain, and the URL typed into the app by a super admin. That doesn't scale: every new business signup would require a manual infra step from your hosting admin.

**The goal:** when a super admin creates a new business in the app and hits submit, that tenant's subdomain (e.g. `ctfi.cloudhousefinance.com`) should be instantly live — no manual DNS or SSL step per tenant, ever again.

**The fix has two parts:**

1. **Infra (admin does this once, not per tenant)** — set up a *wildcard* DNS record and a *wildcard* SSL certificate covering `*.cloudhousefinance.com`. This makes every possible subdomain automatically resolve and be HTTPS-secure, forever, with no further manual work.
2. **Code (small change to the app)** — instead of a super admin typing the full tenant URL by hand, the "create business" form auto-generates the subdomain from the business name/code and saves it. Combined with the wildcard DNS/SSL from step 1, this makes the URL live the instant the tenant is created.

The app itself is already built correctly for this: it's one single codebase (Go backend + Next.js frontend) serving all tenants — not a separate build per tenant. Each tenant is just a row in the database, and the app decides which tenant to serve based on the incoming request's domain name.

---

## Part 1 — Send this to your hosting/infra admin

> Subject: Wildcard DNS + wildcard SSL for `*.cloudhousefinance.com`
>
> We want every subdomain under `cloudhousefinance.com` to automatically work, without creating a new DNS record or certificate for each new tenant. Please set up:
>
> **1. Wildcard DNS record**
> ```
> Type: A
> Name: *.cloudhousefinance.com
> Value: <our server's IP address>
> ```
> (If we're behind a load balancer/reverse proxy, point it there instead — same idea.)
>
> **2. Wildcard SSL certificate**
> A certificate covering `*.cloudhousefinance.com`, ideally via Let's Encrypt using a DNS-01 challenge (this is required for wildcard certs — the standard HTTP-01 challenge doesn't support wildcards). Tools like Certbot, Caddy, or the reverse proxy (Nginx/Traefik) can automate issuance and renewal.
>
> Once both are in place, any subdomain (`ctfi.cloudhousefinance.com`, `foo.cloudhousefinance.com`, etc.) should resolve to our server and be served over HTTPS automatically — no manual step needed per tenant going forward.

**What to check once your admin confirms it's done:**
- Pick a random subdomain that has never been created before, e.g. `test123.cloudhousefinance.com`.
- Visit it in a browser. It should load (even if it just shows a generic "tenant not found" page from the app) over HTTPS with a valid padlock — no cert warning.
- If that works, the wildcard DNS + SSL is confirmed working.

---

## Part 2 — Code changes (come back to me for this once Part 1 is confirmed)

Once wildcard DNS/SSL is live, the app needs one change: **auto-generate the tenant's subdomain URL instead of requiring the super admin to type it in manually.**

Current behavior (found in the codebase):
- Tenant creation: `POST /businesses` → `backend/internal/superadmin/handler.go` (`CreateBusiness`) → `backend/internal/superadmin/service.go` (`Service.CreateBusiness`)
- The request includes an `AppURL` field that's manually supplied by the super admin — nothing generates it automatically.
- Host-to-tenant matching already exists: `backend/internal/tenant/host.go` (`FindByAppURL`) and `backend/internal/platform/request_host.go` (`RequireHostMatchesTenant` middleware) — the app already knows how to match an incoming request's domain to a tenant's stored `AppURL`.

What needs to change:
1. In the "create business" flow, derive a URL-safe subdomain from the business name/code (e.g. "CTFI" → `ctfi`), instead of accepting a free-typed `AppURL`.
2. Automatically set `AppURL = https://<subdomain>.cloudhousefinance.com` when saving the new tenant.
3. Validate the generated subdomain is unique (no collisions with an existing tenant) before saving.
4. (Optional) Show the generated URL back to the super admin in the UI immediately after creation, so they can share it right away.

This is a scoped, low-risk change since the host-matching logic already exists — it's just closing the gap between "tenant created" and "URL is live," instead of requiring a manual URL entry.

---

## Part 3 — Verifying it works end to end

1. Create a new business/tenant through the super admin panel with a distinct name (e.g. "CTF Demo").
2. Confirm the generated URL (e.g. `https://ctfdemo.cloudhousefinance.com`) is saved against that tenant.
3. Visit that URL directly in a browser, without touching DNS or asking the admin for anything.
4. Confirm it loads the correct tenant's login/branding — not another tenant's, and not a 404/cert error.

If all four steps work without any manual admin intervention, the automation is complete.

---

## Optional future step — custom domains per tenant

If down the line a tenant wants their own domain (e.g. `mycompany.com` instead of `mycompany.cloudhousefinance.com`), that's a separate, more advanced feature: the tenant points a CNAME at your server, you verify domain ownership, and issue/renew a certificate specifically for that domain (e.g. via Let's Encrypt's HTTP-01 or DNS-01 challenge per custom domain). Not needed now — just worth knowing it's a natural next step later.
