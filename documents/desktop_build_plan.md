# Desktop App: Backblaze B2 + per-tenant build & update system

## Context

The desktop app today is built and released by hand, per tenant, from a terminal. You want
the same process available as buttons in superadmin, storage moved to Backblaze B2, releases
organized per tenant, and a scalable way to push feature updates to many tenants without
rebuilding each one fully.

---

## 1. Storage — move to Backblaze B2

- **Want:** Use B2 for storing release files instead of the current provider.
- **Current:** Upload/download scripts already work with any S3-style storage — only the
  connection details need to change.
- **Plan:** Point the existing scripts at B2. `npm run dist` (local build, no upload) stays
  exactly as is — untouched. Only `npm run release` / superadmin-triggered releases upload to B2.
- **Still need from you:** confirm the Application Key (secret) and which part you gave me is
  the bucket name vs. folder path.

## 2. One folder per tenant in B2

- **Want:** Tenant A's update check should never see tenant B's version.
- **Current:** Tenant identity already exists — it's the business's existing slug/code
  (`ctfi`, `demo`, etc.) — just not used for this yet.
- **Plan:** One folder per tenant code inside the bucket. Each folder holds that tenant's
  files + a small "latest version" pointer.
- **Example:**
  `Buckets/software-products/cloudhouse-finance/ctfi/ctfi-finance-1.4.0-win.exe`
  `Buckets/software-products/cloudhouse-finance/ctfi/latest.json` ← points to 1.4.0 (full install)

- **Content updates live in one shared folder, not copied per tenant** (your idea, adopted):
  since a content package is identical for every tenant, it's published **once**, in a common
  folder sitting next to the per-tenant folders — not duplicated into each one.
  ```
  cloudhouse-finance/
    common/
      content-1.5.0.zip
      latest-content.json   ← points to content-1.5.0.zip
    ctfi/
      ctfi-finance-1.4.0-win.exe
      latest.json            ← points to the full-installer version, per tenant
    demo/
      demo-finance-1.3.0-win.exe
      latest.json
  ```
  The installed app then checks **two places**, not one:
  1. Its own tenant folder's `latest.json` → "is a newer full installer available for me."
  2. The shared `common/latest-content.json` → "is a newer content package available for
     anyone" (same for every tenant, checked once, applies to all).
  Either one appearing newer than what's currently running triggers the same popup — a content
  update doesn't need its own per-tenant copy, and publishing one is a single upload, not 100.

## 3. The scaling problem (your idea, confirmed good)

- **Want:** Ship a new feature/page to 50–100 tenants without rebuilding the whole app for
  each one. Each tenant keeps its own icon/name.
- **Current:** Every release today rebuilds everything — content + icon/name + native app —
  per tenant. Not practical at scale.
- **Plan (your idea, verified workable):**
  - First time a tenant is onboarded → one full build (content + their icon/name + native app).
  - Later feature updates → build the content **once**, upload it as a small package, every
    already-installed app downloads and swaps in just that package. No reinstall, icon/name
    untouched.
  - Full rebuild only happens again if something native itself changes (rare).
- **Example:** Add one new button to a screen → build it once → 100 tenants each pull the same
  small content package, instead of 100 full rebuilds.

- **What CAN ship as a content-only package (no rebuild needed):**
  - New pages/screens
  - New cards, buttons, their shapes, colors, templates
  - Fonts, layout, styling changes
  - Calculations / business logic (anything written in the app's own code)
  - Images/icons used *inside* screens (not the app's own taskbar icon)
  - Any change that lives in the web app's code — this covers the large majority of normal
    feature work, including every example you listed.

- **What CANNOT — still needs a full native rebuild:**
  - The app's own icon/taskbar icon and installer-level branding
  - New hardware support (printer, cash drawer, scanner)
  - Window behavior (title bar, rounded corners, tray behavior)
  - The updater mechanism itself
  - Any change inside the native Go/Wails code, or a Wails version upgrade
  - **Example:** adding a "print receipt directly to a thermal printer" feature needs a native
    rebuild (new hardware access code). Adding a new "Reports" page, changing a button's shape,
    or changing a calculation formula does **not** — all of that ships as a content package.

- **How a printer/scanner change actually gets to every tenant:**
  - The native printer/scanner code itself is written **once** — it's shared code, not
    per-tenant, same as today.
  - But because it changed the native shell (not just content), it can't be swapped in like a
    content package — each tenant's installed app genuinely needs a new, real installer this
    time (same as onboarding), since the compiled program itself changed.
  - The good news: you already have an auto-updater that installs a whole new version when one
    is available — this is the exact same mechanism, so tenants still don't do anything manual;
    their app just offers a real update instead of a quiet content swap.
  - **In short:** you write the printer code once → trigger "rebuild everyone," but mark it as
    a **full rebuild** (not content-only) this one time → every tenant gets a real new
    installer via the same popup/auto-update they already have.
  - **Confirming your question:** yes — a full rebuild still means building one-by-one (or a
    few at a time) per tenant, e.g. 10 tenants = 10 real builds that round, same as onboarding.
    Nothing is lost: each one of those 10 builds automatically pulls that same tenant's already
    -stored icon and name, same as it always has — a full rebuild doesn't mean re-entering
    branding, just redoing the build step with the branding that's already on file.

- **Where you choose "content-only" vs "full rebuild":** one choice on the same rebuild
  trigger, not two different features to remember:
  - **Terminal:** `npm run release` ships a content-only package by default; a flag (e.g.
    `--full`) tells it to produce a real installer instead.
  - **Superadmin (single tenant or "rebuild everyone"):** the same dialog where you confirm and
    type the version number also has one choice: **Content update (fast, default)** or
    **Full rebuild (native code changed)**. You pick it once per release, based on whether you
    touched native code — everything else about the flow (progress bar, cancel, B2 folder
    structure) is identical either way.

  **Scenario A — single tenant, from the business detail page:**

  ```
  Business detail page (ctfi)
  ┌───────────────────────┐
  │  Business: ctfi        │
  │  [ Rebuild this app ] │
  └───────────┬───────────┘
              ▼
  ┌─────────────────────────────────────────────┐
  │  Rebuild — ctfi                              │
  │                                                │
  │  New version:  [ 1.4.0 ]  (must be higher)   │
  │                                                │
  │  Update type:  ( ) Content update — fast      │
  │                ( ) Full rebuild — native code │
  │                                                │
  │  Build for:    [x] Windows  [ ] Mac  [ ] Linux│
  │  (only shows OS targets this product ships;    │
  │   check more than one to build each at once)  │
  │                                                │
  │        [ Cancel ]      [ Confirm & start ]   │
  └───────────────────┬───────────────────────────┘
                      ▼
  ┌─────────────────────────────────────────────┐
  │  Progress — ctfi                              │
  │  Windows:  Building…               [Cancel]  │
  │  Mac:      Preparing…              [Cancel]  │
  └─────────────────────────────────────────────┘
  ```

  Each checked OS gets its own file and its own row — e.g. `ctfi-finance-1.4.0-win.exe` and
  `ctfi-finance-1.4.0-mac.dmg`, both tracked under `ctfi/`'s latest-version info. Cancelling
  Windows here doesn't touch the Mac row either — same independence rule as Scenario B.

  **Scenario B — every tenant, from the business list page:**

  ```
  Business list page
  ┌───────────────────────┐
  │ [ Rebuild all ]       │
  └───────────┬───────────┘
              ▼
  ┌─────────────────────────────────────────────┐
  │  Rebuild — all tenants                       │
  │                                                │
  │  New version:  [ 1.4.0 ]  (must be higher)   │
  │                                                │
  │  Update type:  ( ) Content update — fast      │
  │                ( ) Full rebuild — native code │
  │                                                │
  │  Build for:    [x] Windows  [ ] Mac  [ ] Linux│
  │                                                │
  │        [ Cancel ]      [ Confirm & start ]   │
  └───────────────────┬───────────────────────────┘
                      │
          ┌───────────┴────────────┐
          ▼ if "Full rebuild"       ▼ if "Content update"
  ┌─────────────────────────┐   ┌─────────────────────────────┐
  │ Progress — all tenants   │   │ Progress — content update    │
  │                          │   │                               │
  │ ctfi (Win): Building…    │   │ Building content…               │
  │        [Cancel]          │   │          ▼                      │
  │ ctfi (Mac): Preparing…   │   │ Uploading…                     │
  │        [Cancel]          │   │          ▼                      │
  │ demo (Win): Uploading…   │   │ Verifying…  ✓ Done              │
  │        [Cancel]          │   │                               │
  └─────────────────────────┘   └─────────────────────────────┘
  ```

  **Corrected from your note:** since the content package is published once to a shared folder
  (not copied per tenant), a "content update" release shows **one progress bar**, not one row
  per tenant — there's nothing per-tenant left to do once that single upload finishes. A "full
  rebuild" is the one that still shows one row per tenant, per OS checked, because each of those
  genuinely is a separate real build.

  **Cancelling one row never affects the others.** Each tenant/OS row in the "full rebuild" view
  is its own independent build — cancelling `ctfi (Mac)` stops only that one; `ctfi (Win)` and
  `demo (Win)` keep going untouched. (The "content update" view has only one shared bar, so
  cancelling it simply cancels the one shared publish — nothing tenant-specific to isolate.)

- **One wrinkle worth flagging now that content is shared, not per-tenant:** "Content update"
  only really makes sense from Scenario B (it's the same package for everyone, by definition) —
  picking it from a single tenant's page (Scenario A) would either mean "publish this for
  everyone, I just clicked it from ctfi's page," which is confusing, or it shouldn't be offered
  there at all. My suggestion: **only show "Content update" as an option on the business list
  page (Scenario B)**; the single-tenant page (Scenario A) only offers "Full rebuild," since a
  content-only change can't sensibly apply to just one tenant. Let me know if you'd rather keep
  both choices on both pages instead, with Scenario A's "Content update" meaning "everyone."

- **Content update vs. full rebuild — no difference the tenant ever sees.** Once either one
  finishes, the installed desktop app shows the exact same "update available" popup, worded the
  same way. The tenant never knows or needs to know which kind it was — that distinction only
  matters to how the backend produces the release, not to what the tenant experiences.

## 4. Who actually builds it — reuse GitHub Actions

- **Want:** Trigger builds from the website, not just a terminal.
- **Current:** You already build Win/Mac/Linux via GitHub Actions when you push a version tag.
  Your own PC is Windows, your server is Ubuntu — Ubuntu alone can't make a Windows build.
  The build itself runs on **GitHub's own cloud machine**, not your server, not your PC — that
  hasn't changed, you're just adding a second way to start it.

- **Plan, step by step, plain English:**
  1. Your workflow file (`release.yml`) already exists and already works by git tag. It will be
     edited (to add inputs and fix the upload-gating issue below) — editing it is expected and
     fine; what's preserved is the *behavior*: pushing a tag still works exactly as today.
  2. We add one more way to start that same file: GitHub lets you call it directly through an
     API request ("run this workflow now, here are the inputs") instead of only via a tag.
     This is called a "workflow dispatch."
  3. The backend stores a GitHub access key (like a password that lets it act on your behalf)
     so it's allowed to make that request.
  4. You click "Rebuild" in superadmin → backend sends GitHub one request: "run the release
     workflow, tenant=ctfi, version=1.4.0."
  5. GitHub queues it on its own machine (a Windows one, same as always) and starts running the
     same steps your workflow file already has: checkout code → install → build → package →
     upload → verify.
  6. While that's running, the backend asks GitHub a second kind of request, repeatedly, every
     few seconds: "how is that run going, which step is it on." GitHub answers with exactly
     that, because your workflow file already names each step.
  7. The backend takes that answer and shows it as the progress bar in your browser.

- **Yes — build runs on GitHub's machine, you watch from your browser.** You don't need to open
  github.com or check from the server. The backend is just relaying what GitHub reports, the
  same information GitHub would show on its own site, displayed inside your own app instead.

- **Your own PC being Windows and your server being Ubuntu doesn't matter or limit anything
  here.** GitHub Actions isn't "a machine" — it's GitHub's own cloud, and it separately provides
  a Windows machine, a Mac machine, and a Linux machine on request, regardless of what OS your
  PC or server runs. That's exactly why you're already able to build all three today from a
  single workflow file — this plan doesn't change that ability, it just adds a second way to
  start the same thing. So no, there's no OS limitation either way.
- **You can also watch it on github.com directly, in parallel, if you want** — nothing about
  this setup is exclusive to our own superadmin screen. The backend is reading the same public
  run status that github.com's own "Actions" tab shows; checking both at once is completely
  fine and won't interfere with anything.

- **How the real step-by-step progress (build → upload) is actually obtained:** your workflow
  file already lists real, separate steps internally (checkout, install Node, install Go,
  install dependencies, build, upload, verify). GitHub's API reports exactly which of these is
  currently running, with no guessing involved — but what you actually see on screen is
  collapsed into plain, general stages, not that internal list:
  1. **Preparing** — getting the code and tools ready
  2. **Building** — producing the installer (content + native shell + branding)
  3. **Uploading** — pushing the finished file to B2
  4. **Verifying** — confirming it landed correctly, then marked **Done**

- **Good news — this workflow already has `workflow_dispatch:` enabled** (line 6 of the file),
  meaning the on-demand/button trigger capability already exists; it isn't something to add from
  scratch. What's still needed:
  - Add actual **inputs** to that trigger (tenant code, version, content-vs-full choice) — right
    now it can be started manually but doesn't accept any of this information yet.
  - **Fix a gating bug for this plan's purposes:** steps 6–7 (upload, verify) currently only run
    `if: github.event_name == 'push'` — meaning a manual/on-demand run today would build but
    silently skip uploading and verifying. That condition needs to also allow a
    `workflow_dispatch` run through, or button-triggered releases would quietly never reach B2.

### Workflow diagram — on-demand build trigger

```
 Superadmin page (your browser)
         │  click "Rebuild", confirm, enter version
         ▼
 Backend (gold-app server)
         │  1. save a job record: tenant, version, status = "starting"
         │  2. call GitHub API: "run release.yml, inputs: tenant=ctfi, version=1.4.0"
         ▼
 GitHub Actions (GitHub's own cloud machine — not your server)
         │  queues the run, starts executing release.yml's steps:
         │     checkout → setup node/go → install → build web app →
         │     package native app → upload to B2 → verify upload
         ▼
 Backend polls GitHub every few seconds: "status of that run?"
         │  GitHub answers with the current step name + done/in-progress/failed
         ▼
 Backend updates the job record's status
         │
         ▼
 Superadmin page polls the backend's job record (not GitHub directly)
         │  shows "step 4 of 7 — uploading" etc., live, survives refresh
         ▼
 Run finishes → backend confirms the file + pointer exist in B2 →
 job marked "done" (or "failed"/"cancelled" — nothing partial ever
 reaches B2 in either of those cases)
```

## 4a. Two more small rules you added

- **Version field only accepts a higher number than the tenant's current latest** — typing an
  equal or lower version is blocked right in the dialog, not caught later after wasting a build.
- **Download buttons in superadmin should match what was actually built per tenant** — if only a
  Windows build exists for a tenant, show only a Windows download button; once a Mac build
  exists too (because it was checked in the "Build for" boxes above), a Mac button appears next
  to it, automatically, without manual toggling.

## 5. Superadmin buttons

- **Want:** Rebuild one tenant (business page), rebuild everyone (business list page), and
  start first build at the end of the new-business wizard. Each needs: confirm → enter version
  → progress bar by stage (e.g. "4 of 7") → survives refresh/close → cancel = nothing uploaded.
- **Current:** No job tracking exists in the backend at all today.
- **Plan:** Add a simple job record per release (tenant, version, stage, status), fed by the
  GitHub polling described in section 4's diagram. Superadmin page polls this record (not
  GitHub directly), so refreshing or closing doesn't lose progress.

## 6. Terminal and buttons use the same logic

- **Want:** Running a build by hand from a terminal must behave exactly like clicking the
  button — same rules, same folders, same pointer updates.
- **Plan:** One shared piece of release logic. The terminal command and the button both call
  into it — it's not written twice.

## 7. Desktop app update popup

- **Want:**
  - Popup appears every time the app opens/refreshes if a newer version exists (not
    snoozed forever after closing it).
  - A dot indicator stays visible the whole time an update is pending — from when it's found
    until the app is actually running that version — regardless of popup dismiss or a
    download that hasn't been restarted yet.
  - Clicking download opens Settings, on the version section.
  - Desktop only — never shown on the web version.
  - "Newer" = higher version number (e.g. 0.0.2 > 0.0.1), same check the app's updater
    already does correctly today — reused, not reinvented.
- **Plan:** Build this UI in the desktop bridge/Settings screen only, reusing the existing
  version-compare logic, and extend the updater to also recognize a content-only update
  (from point 3) in addition to a full installer update.

## Still need from you

- I'll add the required B2 key names as empty placeholders in `.env.example` and `.env.local` —
  you'll fill in the real values (Application Key, bucket name, folder path, etc.) yourself.
- Testing will use local/mock business data, not real tenants, for now (as you said).

## Verification

- Terminal release and button release produce identical results in B2.
- `npm run dist` still uploads nothing.
- Refresh mid-build on superadmin page → progress still correct.
- Cancel a build → nothing appears in that tenant's B2 folder.
- Ship a content-only update to a mock tenant → app updates screens, keeps its icon/name, no
  reinstall prompt.
- Older-version desktop app → popup shows every open, dot stays until updated.
