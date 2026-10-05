# One mobile build, one common backend domain, many tenants

Audience: backend/DevOps engineer pulling this onto the server. It explains how
the staff mobile app (`mobile/`) reaches the real backend with a **single build
shared by every tenant**, what the server must provide, and every endpoint the
connect + sign-in flow uses (request, response, errors).

Everything below was read from the code at the time of writing; file references
are given so each claim can be re-checked.

---

## 1. The idea in one paragraph

Web reaches a tenant through its **subdomain** (`ctfi.cloudhousefinance.com`).
Mobile cannot ship one build per subdomain, so it calls **one fixed API host**
(recommended: `api.cloudhousefinance.com`) and tells the backend which business
it means by sending the **business code** (`ctfi`) in the request body. After
login, the tenant lives inside the **JWT**, so no code or subdomain is sent
again. The backend does not store anything per domain; the domain is only a
name that points at the same server and the same Go process.

| | Web | Mobile |
|---|---|---|
| Host called | `<code>.cloudhousefinance.com` | one fixed host, e.g. `api.cloudhousefinance.com` |
| Tenant before login | Host subdomain | `businessCode` in JSON body / URL path |
| Tenant after login | JWT `tenantId` | JWT `tenantId` |
| CORS | needed (browser) | not applicable (native app) |

---

## 2. End-to-end flow

```
[Web dashboard, tenant ctfi]            [Phone, shared build]                [Backend  api.cloudhousefinance.com]
  logged in as ctfi admin
  POST /api/v1/branding/connect-code  ------------------------------------>  issue 6-char code for tenant "ctfi" (3 min, in memory)
  <- { code:"K7M2QX", expiresIn:180 }
  shows QR  cloudhouse://connect?c=K7M2QX
                                          scan QR / type code
                                          GET /api/v1/public/connect/K7M2QX ->  lookup code
                                          <- { businessCode:"ctfi" }
                                          save "ctfi" in SecureStore
                                          GET /api/v1/public/branding/ctfi -->  brand name/colour/logo (no auth)
                                          POST /api/v1/auth/login
                                            { identifier, password,
                                              businessCode:"ctfi" }  -------->  resolve tenant by code, check credentials
                                          <- { token, employee }                JWT carries tenantId
                                          every later call:
                                            Authorization: Bearer <token> --->  tenant from JWT only
```

---

## 3. What the mobile app does (client side)

| Concern | Where |
|---|---|
| API host | `mobile/src/api/config.ts` — `BACKEND_URL` (hardcoded fallback) and `API_BASE_URL = EXPO_PUBLIC_API_BASE_URL \|\| BACKEND_URL` |
| Build-time host | `mobile/eas.json` -> `build.base.env.EXPO_PUBLIC_API_BASE_URL` |
| Business code storage | `mobile/src/auth/businessCode.ts` — SecureStore key `cloudhousestaff_business_code`; validated `^[a-z0-9][a-z0-9-]*$`, max 60 chars |
| Connect screen | `mobile/app/(auth)/connect.tsx` |
| Connect-code parsing | `parseConnectQr` — accepts `cloudhouse://connect?c=<code>` or a bare 6-char code (alphabet `ABCDEFGHJKMNPQRSTUVWXYZ2-9`) |
| HTTP client | `mobile/src/api/client.ts` — adds `Authorization: Bearer <token>` unless `skipAuth`; 20 s timeout |
| Response unwrapping | `apiRequestEnveloped` — returns `data` (or `message`) from the envelope |

The tenant is **never** part of the host. Once the host is set, the same
binary works for every tenant.

### Client changes needed for production (checklist)

1. `mobile/src/api/config.ts`: set `BACKEND_URL` to `https://api.cloudhousefinance.com/api/v1`.
2. `mobile/eas.json` `build.base.env.EXPO_PUBLIC_API_BASE_URL`: same value.
3. `mobile/eas.json`: **remove** `EXPO_PUBLIC_DEFAULT_BUSINESS_CODE` — a shared build must not default to any tenant (grep shows it is not read anywhere in `mobile/src`; it is a leftover).
4. Do not ship `mobile/.env.local` values: it points at an ngrok URL and is for local dev only.
5. Build once: `eas build --profile production --platform android|ios`.

---

## 4. What the backend/server must provide

### 4.1 DNS, TLS, proxy

- A DNS record for `api.cloudhousefinance.com` pointing at the server (already covered if the `*.cloudhousefinance.com` wildcard record exists).
- A TLS certificate that covers it (a wildcard `*.cloudhousefinance.com` cert already does).
- The reverse proxy (nginx/Caddy/etc.) must accept `Host: api.cloudhousefinance.com` and forward to the same Go backend that serves the tenant subdomains. If `server_name` lists tenants explicitly, add this host or use a wildcard. **No repo config for the proxy exists** (only `docker-compose.yml`), so this lives on the server.
- Forward the original `Host` header (`proxy_set_header Host $host;`). The backend reads it for the host fallback and for the host/tenant mismatch check; a proxy that rewrites it breaks web subdomains.

### 4.2 The backend already treats `api` as a non-tenant host

`backend/internal/tenant/host.go`:

```go
var ReservedHostLabels = map[string]bool{
    "www": true, "api": true, "admin": true, "superadmin": true,
}
```

`SubdomainLabel("api.cloudhousefinance.com")` returns `ok=false`, so:

- `api` can never be resolved as a tenant code from the Host.
- Login with a `businessCode` still works from this host: `auth.Service.resolveTenant` looks up the code first (`service.go:117-125`) and only falls back to the Host when no code is sent (`service.go:134-138`).
- `platform.RequireHostMatchesTenant` (`request_host.go:68`) only **refuses** when the host maps to a *different* tenant. A host that maps to no tenant ("the shared API domain") passes through. So a JWT for `ctfi` used against `api.cloudhousefinance.com` is accepted.

Also confirm a tenant cannot be **created** with code `api` (or `www`, `admin`, `superadmin`). `ReservedHostLabels` is enforced when resolving a host, but verify the tenant-creation validation in `internal/superadmin` rejects these codes too; otherwise a tenant coded `api` would have a code that its own subdomain can never reach. (Not verified in this review.)

### 4.3 Config

| Env | Value | Why |
|---|---|---|
| `BASE_DOMAIN` | `cloudhousefinance.com` (default) | used by `tenant.SubdomainLabel`; `config.go:188` |
| `FRONTEND_ORIGIN` | include `https://*.cloudhousefinance.com` | web browsers only; mobile ignores CORS (`app.go:62-128`) |

### 4.4 Connect codes are stored in process memory

`branding/connect.go` keeps issued codes in a `map` inside the Go process (TTL
3 minutes). Consequences for the server:

- **One backend instance**: works as-is.
- **More than one instance behind a load balancer**: the web modal may issue the code on instance A and the phone redeem it on instance B -> `404 this code is invalid or has expired`. Fix by either sticky sessions for `/api/v1/branding/connect-code` and `/api/v1/public/connect/*`, or moving the store to Redis/DB.
- A restart drops outstanding codes (acceptable; they expire in 3 minutes).

---

## 5. API reference (connect + sign-in flow)

Base URL: `https://api.cloudhousefinance.com/api/v1`

All responses use the house envelope (`backend/internal/platform/httpx/envelope.go`):

```jsonc
// success, single resource
{ "success": true, "data": { ... } }
// success, message only
{ "success": true, "message": "..." }
// failure
{ "success": false, "error": "human readable message" }
```

Headers the app sends: `Content-Type: application/json`, and
`Authorization: Bearer <JWT>` on authenticated calls. (It also sends
`ngrok-skip-browser-warning: true`; harmless against a real host.)

### 5.1 Issue a connect code — web dashboard (authenticated)

`POST /branding/connect-code`

- Auth: `Authorization: Bearer <staff JWT>` (the route is mounted under the authenticated group; `branding/routes.go:32`).
- Body: none. The tenant comes from the token, never a parameter.
- Header on response: `Cache-Control: no-store`.

`201 Created`
```json
{
  "success": true,
  "data": {
    "code": "K7M2QX",
    "expiresAt": "2026-10-05T10:33:00.000Z",
    "expiresIn": 180
  }
}
```

Errors: `401 no business in session`; `503 could not generate a connect code, try again`.

The web renders the QR as `cloudhouse://connect?c=K7M2QX`.

### 5.2 Redeem a connect code — mobile (public)

`GET /public/connect/:code`

- Auth: none.
- `:code` is normalised server-side: upper-cased, spaces and `-` removed (`ABC-123`, `abc 123` all work). Must be exactly 6 characters after normalising.
- The code is **not consumed** on success (so a dropped first attempt can be retried); it simply expires after 3 minutes.
- Header on response: `Cache-Control: no-store`.

`200 OK`
```json
{ "success": true, "data": { "businessCode": "ctfi" } }
```

Errors: `404 this code is invalid or has expired — generate a new one from the web dashboard` (unknown, expired and wrong-length codes are indistinguishable by design).

### 5.3 Public branding for the login screen — mobile (public)

`GET /public/branding/:code`

- Auth: none. **Always 200**: an unknown code returns platform defaults, so this cannot be used to enumerate businesses.

`200 OK`
```json
{
  "success": true,
  "data": {
    "name": "CT Finance",
    "legalName": "CT Finance Pvt Ltd",
    "shortName": "CTFI",
    "lockupTagline": "",
    "brandColor": "#6054bf",
    "secondaryColor": "",
    "accentColor": "",
    "sidebarColor": "",
    "fontFamily": "inter",
    "fontScale": "default",
    "logoScale": "default",
    "logoDisplay": "transparent",
    "logoUrl": "/api/v1/public/branding/ctfi/logo?v=<storageKey>",
    "appUrl": "https://ctfi.cloudhousefinance.com"
  }
}
```

Defaults when unknown / unset (`branding/model.go`): name `CloudHouse Finance`, `brandColor` `#6054bf`, font `inter`, scales `default`, `logoDisplay` `transparent`, empty `logoUrl`.

`logoUrl` is **server-root-relative** or empty. The app joins it to the origin (`API_ORIGIN` in `mobile/src/api/config.ts` = base URL minus `/api/v1`), so the logo is fetched from the same common host:
`GET /public/branding/:code/logo` (public, image bytes, `Cache-Control: public, max-age=3600`, `404 no logo for this business` when absent).

Host-based variant (used by the web login page, **not** by the mobile app): `GET /public/branding` resolves the tenant from the Host header and returns the defaults for any host that is not a tenant subdomain (including `api.`).

### 5.4 Login — mobile (public)

`POST /auth/login`

Request body (`auth/model.go`):
```json
{
  "identifier": "ravi",
  "password": "secret",
  "businessCode": "ctfi"
}
```

| Field | Required | Notes |
|---|---|---|
| `identifier` | yes | username **or** phone |
| `password` | yes | |
| `businessCode` | effectively yes for a shared build | optional only while exactly one business exists in the whole database |

Tenant resolution (`auth/service.go:113-148`), in order:
1. `businessCode` present -> `FindByCode`. Not found returns the **same error as a wrong password** (no enumeration).
2. else Host subdomain -> `FindByHostLabel` (never matches `api.`).
3. else, if exactly one tenant exists -> that tenant.
4. else `ErrBusinessCodeRequired`: `400 please use your organisation's sign-in link, or enter your business code`.

`200 OK`
```json
{
  "success": true,
  "data": {
    "token": "<JWT HS256>",
    "employee": {
      "id": 12,
      "code": "EMP012",
      "name": "Ravi Kumar",
      "role": "Manager",
      "roleId": 3,
      "branchId": 1,
      "branch": { "id": 1, "name": "Head Office", "...": "..." },
      "phone": "98xxxxxx",
      "username": "ravi",
      "email": "",
      "createdAt": "...",
      "updatedAt": "..."
    }
  }
}
```
(`employee` is the `employee.Employee` struct; `passwordHash` and reset fields are `json:"-"` and never returned. Field list above is the subset read from `employee/model.go`; more stats fields such as `loansProcessed`, `collections`, `followups`, `pending` are also present.)

The response also sets an auth cookie (`upload.SetAuthCookie`) for `<img src="/uploads/...">`; the mobile app ignores it and uses the Bearer token.

Errors: `400 Invalid input` (missing/invalid JSON); invalid credentials or unknown business code (`ErrInvalidCredentials`, identical for both); `400 please use your organisation's sign-in link, or enter your business code`.

**JWT payload** (`platform/jwt.go`, `Claims`):
```json
{
  "employeeId": 12, "role": "Manager", "roleId": 3,
  "tenantId": 7, "branchId": 1, "type": "employee",
  "iat": 1790000000, "exp": 1790600000
}
```
`tenantId` is the **only** source of the tenant on every authenticated request. It is never read from a header, query, body or URL. `IssueToken` refuses `tenantId == 0`.

### 5.5 Current user — authenticated

`GET /auth/me` with `Authorization: Bearer <JWT>`

`200 OK` -> `{ "success": true, "data": <Employee> }`. Errors: `401 missing Authorization header | malformed Authorization header | invalid or expired token | your session is no longer valid — please sign in again`; `401 your session predates a security update — please sign in again` when `tenantId == 0`.

### 5.6 Own branding after login — authenticated

`GET /branding`

Tenant from the token. `200 OK`:
```json
{
  "success": true,
  "data": {
    "name": "...", "legalName": "...", "shortName": "...", "lockupTagline": "",
    "brandColor": "#...", "secondaryColor": "", "accentColor": "", "sidebarColor": "",
    "fontFamily": "inter", "fontScale": "default", "logoScale": "default", "logoDisplay": "transparent",
    "logoUrl": "/api/v1/public/branding/ctfi/logo?v=...", "appUrl": "https://ctfi.cloudhousefinance.com",
    "addressLine": "...", "kmlRegNo": "...",
    "modules": ["..."], "languages": ["en", "gu"],
    "singleBranch": false
  }
}
```
Error: `401 no business in session`.

### 5.7 Forgot / reset password — mobile (public)

All three carry `businessCode` because a phone/username is unique only within a business.

`POST /auth/forgot-password`
```json
{ "businessCode": "ctfi", "username": "ravi", "phone": "98xxxxxx" }
```
`200` -> `{ "success": true, "message": "A reset code has been sent by SMS." }`
Errors: `404` no employee in that business with that username + phone; `403` employee has no login; `503` SMS could not be sent; `400 Invalid input`.

`POST /auth/verify-reset-code`
```json
{ "businessCode": "ctfi", "username": "ravi", "phone": "98xxxxxx", "otp": "123456" }
```
`200` -> `{ "success": true, "message": "Code verified." }` (the code is not consumed).

`POST /auth/reset-password`
```json
{ "businessCode": "ctfi", "username": "ravi", "phone": "98xxxxxx", "otp": "123456", "newPassword": "NewSecret1" }
```
`200` -> `{ "success": true, "message": "Password has been reset. You can now log in." }`

### 5.8 Every other endpoint

All remaining `/api/v1/*` routes (loans, customers, cash, reports, ...) require
`Authorization: Bearer <JWT>` and are scoped by the JWT's `tenantId`
(`AuthMiddleware` -> `PinTenantConn` -> Postgres RLS). They behave identically on
`api.cloudhousefinance.com` and on a tenant subdomain, because the tenant is not
taken from the host. Permission checks use `roleId` resolved live per request.

---

## 6. Security properties worth keeping

- The Host is client-supplied. It may **narrow or refuse**, never authorise (`request_host.go`, `host.go`).
- A wrong business code and a wrong password return the same error; unknown branding codes return defaults, never 404 (anti-enumeration).
- Connect codes grant nothing: they only reveal the business code; the user still needs their own username and password.
- Customer, staff and superadmin JWTs share one signing secret but are separated by the `type` claim.
- `RequireHostMatchesTenant` stays on: a `ctfi` token replayed against `ambika.cloudhousefinance.com` is rejected, while `api.cloudhousefinance.com` (matches no tenant) is allowed. That asymmetry is what makes the shared API host work.

---

## 7. Verification checklist after deploying `api.cloudhousefinance.com`

```bash
# 1. Host reaches the backend and branding works without a tenant subdomain
curl -s https://api.cloudhousefinance.com/api/v1/public/branding/ctfi

# 2. Unknown code gives platform defaults (200), not 404
curl -s -o /dev/null -w "%{http_code}\n" https://api.cloudhousefinance.com/api/v1/public/branding/doesnotexist

# 3. Bad connect code -> 404
curl -s -w "\n%{http_code}\n" https://api.cloudhousefinance.com/api/v1/public/connect/AAAAAA

# 4. Login with a code from the shared host
curl -s -X POST https://api.cloudhousefinance.com/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"identifier":"<user>","password":"<pass>","businessCode":"ctfi"}'

# 5. Use the token on the shared host
curl -s https://api.cloudhousefinance.com/api/v1/auth/me -H "Authorization: Bearer <token>"

# 6. Cross-tenant check: a ctfi token must be refused on another tenant's host
curl -s -w "\n%{http_code}\n" https://ambika.cloudhousefinance.com/api/v1/auth/me -H "Authorization: Bearer <ctfi token>"   # expect 401
```

Then on devices: connect one phone to `ctfi` and another to `ambika` with the
**same build**, and confirm each sees only its own data, plus "Exit business" ->
reconnect to a different tenant.

## 8. Open items to confirm on the server side

1. Tenant creation rejects codes in `ReservedHostLabels` (`api`, `www`, `admin`, `superadmin`).
2. Number of backend instances; if more than one, handle the in-memory connect-code store (section 4.4).
3. Proxy forwards the original `Host` header and accepts `api.cloudhousefinance.com`.
4. `mobile/src/api/config.ts` and `mobile/eas.json` updated to the final API host before the production build.
