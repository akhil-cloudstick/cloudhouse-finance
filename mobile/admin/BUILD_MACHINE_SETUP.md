# Build Machine Setup — iOS/Android builds without sharing the Apple ID

Use this file to set up **any new PC** so it can run `eas build` for the CloudHouse
mobile apps **without the Apple ID password and without 2FA codes**.

The machine authenticates with:

1. **Its own Expo login** (personal Expo account invited to the team, or a robot `EXPO_TOKEN`) — to reach the signing files stored on EAS.
2. **The App Store Connect API key (`.p8`)** — used by EAS instead of an Apple ID login whenever it needs to talk to Apple.

---

## How to use this file

- **Part A** is done **once, ever**, by the Apple Developer account owner. Skip it if it has already been done.
- **Part B** is done **once per new PC**. Paste the prompt in Part B into Claude Code (or any coding agent) running on the new PC, inside the `gold-app` repository, and it will perform every step.
- **Part C** is the day-to-day build command.

### Values the developer must have before starting Part B

Get these from the account owner over a private channel (never in git, never in a public chat):

| Value | Example | Where the owner finds it |
|---|---|---|
| `.p8` key file | `AuthKey_ABC123XYZ.p8` | Downloaded once when the key was created |
| Key ID | `ABC123XYZ` | App Store Connect → Users and Access → Integrations → App Store Connect API |
| Issuer ID | `69a6de7e-xxxx-xxxx-xxxx-xxxxxxxxxxxx` | Same page, top of the keys list |
| Apple Team ID | `AB12CD34EF` | developer.apple.com → Account → Membership details |
| Apple Team type | `INDIVIDUAL` or `COMPANY_OR_ORGANIZATION` | Same Membership page ("Entity type") |
| Expo access | Invite to the Expo org **or** a robot `EXPO_TOKEN` | expo.dev → Organization → Members / Access tokens |

---

## Part A — One-time setup by the Apple account owner (do once, ever)

> Only the person who owns the Apple Developer account does this. Every other PC uses the result.

**A1. Create the App Store Connect API key**
1. Sign in to https://appstoreconnect.apple.com.
2. Go to **Users and Access → Integrations → App Store Connect API**.
3. If API access is not enabled, click **Request Access** (Account Holder only) and accept.
4. Click **Generate API Key** (Team Keys tab), name it `EAS Build`, role **Admin**.
5. Download `AuthKey_<KEYID>.p8`. **Apple allows only one download** — store it in a password manager.
6. Note the **Key ID** and **Issuer ID**.

**A2. Put the Expo projects in a shared Expo organization**
1. Every CloudHouse app (Finance admin and customer, POS, ERP) belongs to the organization `cloudhouse-production` (`"owner": "cloudhouse-production"` in each `app.json`).
2. A developer who builds from their own PC must be a member of `cloudhouse-production`. CI builds use one robot token from it (see `../MOBILE-BUILDS.md`).
3. Invite each developer under **Organization → Members** with the **Developer** role.
4. For a shared/CI build PC with no personal login: **Organization → Access tokens → create robot user token** (role Developer). That token is the machine's `EXPO_TOKEN`.

**A3. Store the iOS signing files and API key on EAS**

On the owner's own PC (the only time an Apple login may be needed):

```bash
cd gold-app/mobile
npm install
npx eas-cli@latest login
npx eas-cli@latest credentials -p ios
```

In the menu:
1. Select build profile **production**.
2. **App Store Connect: Manage your API Key** → **Set up your project to use an API Key for EAS Submit** → give the `.p8`, Key ID, Issuer ID.
3. **Build Credentials** → let EAS **generate** (or upload existing) Distribution Certificate and Provisioning Profile.
4. Repeat steps 1–3 for profile **preview** (internal / ad-hoc distribution).

**A4. Register the test iPhones (internal/preview builds only)**

```bash
npx eas-cli@latest device:create
```

Open the generated link/QR on every test iPhone and install the profile. The next preview build regenerates the ad-hoc provisioning profile with all registered devices.

**A5. Hand out the values** listed in the table above to each developer, privately.

---

## Part B — New PC setup (paste this prompt into the coding agent on the new PC)

Copy everything inside the box below and paste it into Claude Code running in the `gold-app` folder on the new PC.

````text
You are setting up THIS computer as an EAS build machine for the CloudHouse mobile apps
in this repository (gold-app). The goal: this PC must be able to run iOS and Android EAS
builds without ever logging in with an Apple ID and without 2FA codes. Authentication
is done with an App Store Connect API key (.p8) and an Expo login/token.

Follow these steps in order. Stop and tell me if any step fails. Do not skip the checks.

STRICT RULES
- Never ask me for an Apple ID password or a 2FA code. If any command asks for an Apple
  ID login, answer "No" / abort, and tell me — it means the setup is incomplete.
- Never commit, copy into the repo, or print the contents of the .p8 key file.
- Never print the EXPO_TOKEN value back to me in full; show only the first 4 characters.
- Detect the OS first (Windows / macOS / Linux) and use the matching commands below.
- Ask me for each value you need ONE AT A TIME, with a short explanation of where I get it.

STEP 1 — Check prerequisites
- Run: node -v   (must be v20 or newer; if missing, tell me to install Node.js LTS from
  https://nodejs.org and stop)
- Run: git --version
- Confirm the current folder is the gold-app repo root (it contains the folders
  `mobile/admin`, `mobile/customer`, `backend`, `frontend`). If not, ask me for the path.

STEP 2 — Install dependencies and the EAS CLI
- Run: npm install -g eas-cli
- Run: eas --version   (must be >= 24.8.0, as required by mobile/admin/eas.json)
- Run: cd mobile && npm install   (then return to the repo root)
- Run: cd mobile/customer && npm install   (then return to the repo root)

STEP 3 — Store the App Store Connect API key outside the repo
- Ask me for the full path of the AuthKey_XXXXXX.p8 file I received.
- Create a private folder outside the repository:
    Windows: C:\keys
    macOS/Linux: ~/.keys  (then chmod 700 ~/.keys)
- Copy the .p8 file into that folder (do not move it into the repo).
  On macOS/Linux run: chmod 600 ~/.keys/AuthKey_*.p8
- Confirm the file exists at the new path. Remember this full path as KEY_PATH.
- Run `git status` in the repo and confirm no .p8 file appears.

STEP 4 — Set the permanent environment variables
Ask me for: Key ID, Issuer ID, Apple Team ID, Apple Team type
(INDIVIDUAL or COMPANY_OR_ORGANIZATION).

On Windows (PowerShell) set them at USER level so they survive restarts:
  [Environment]::SetEnvironmentVariable("EXPO_ASC_API_KEY_PATH", "<KEY_PATH>", "User")
  [Environment]::SetEnvironmentVariable("EXPO_ASC_KEY_ID", "<KEY_ID>", "User")
  [Environment]::SetEnvironmentVariable("EXPO_ASC_ISSUER_ID", "<ISSUER_ID>", "User")
  [Environment]::SetEnvironmentVariable("EXPO_APPLE_TEAM_ID", "<TEAM_ID>", "User")
  [Environment]::SetEnvironmentVariable("EXPO_APPLE_TEAM_TYPE", "<TEAM_TYPE>", "User")

On macOS/Linux append to the shell profile (~/.zshrc on macOS, ~/.bashrc on Linux),
only if the lines are not already present:
  export EXPO_ASC_API_KEY_PATH="<KEY_PATH>"
  export EXPO_ASC_KEY_ID="<KEY_ID>"
  export EXPO_ASC_ISSUER_ID="<ISSUER_ID>"
  export EXPO_APPLE_TEAM_ID="<TEAM_ID>"
  export EXPO_APPLE_TEAM_TYPE="<TEAM_TYPE>"

STEP 5 — Expo login (ask me which option applies)
Option A — I have my own Expo account that was invited to the `cloudhouse-production`
organization:
  Run: eas login   (I will type my own Expo email/password interactively)
Option B — this is a shared/CI build PC and I was given a robot access token:
  Windows: [Environment]::SetEnvironmentVariable("EXPO_TOKEN", "<TOKEN>", "User")
  macOS/Linux: add  export EXPO_TOKEN="<TOKEN>"  to the shell profile

STEP 6 — Reload and verify
- Tell me to close and reopen the terminal / editor so the new variables load
  (on Windows, the user-level variables are not visible to already-open terminals).
  After I confirm, continue.
- Verify each variable is set (print the Key ID, Team ID and Team type; for the key path
  only confirm the file exists; for EXPO_TOKEN show only the first 4 characters):
    Windows: $env:EXPO_ASC_KEY_ID ; Test-Path $env:EXPO_ASC_API_KEY_PATH
    macOS/Linux: echo $EXPO_ASC_KEY_ID ; test -f "$EXPO_ASC_API_KEY_PATH" && echo OK
- Run: eas whoami   → must print an Expo username or robot name, not "Not logged in".
- Run: cd mobile && eas project:info   → must show the project
  (id 2eefa477-9d29-496f-9e91-06261ed62690). If it says no access, tell me the Expo
  account needs to be invited to the organization that owns the project.
- Run: cd mobile/customer && eas project:info → must show the project
  (id 1fb4bd03-4939-4a9e-9142-c26294cdedbb).

STEP 7 — Test build (ask me before starting; builds use EAS build quota)
- Ask me whether to run a test build now. If yes:
    cd mobile
    eas build -p ios --profile preview --non-interactive
- Watch the output. Success criteria:
    * It does NOT ask for an Apple ID.
    * It prints "Using remote iOS credentials" (or similar) and uploads to EAS.
    * It gives a build URL on expo.dev.
- If it fails with a credentials error, report the exact error message to me and do not
  try to create new certificates — the account owner must fix credentials on EAS
  (Part A3 of mobile/admin/BUILD_MACHINE_SETUP.md).

STEP 8 — Summary
Print a short checklist of what was done with ✓ / ✗ for each step, the Expo account
in use, and the daily build commands from Part C of mobile/admin/BUILD_MACHINE_SETUP.md.
````

---

## Part C — Daily build commands (any set-up PC, several PCs at the same time is fine)

Always add `--non-interactive` so EAS uses the stored credentials and never prompts for an Apple login.

**Staff app (`mobile`)**

```bash
cd mobile

# Internal test build (installs on registered iPhones / APK for Android)
eas build -p ios --profile preview --non-interactive
eas build -p android --profile preview --non-interactive

# Store build
eas build -p ios --profile production --non-interactive
eas build -p android --profile production --non-interactive

# Upload the latest production build to App Store Connect / TestFlight
eas submit -p ios --latest --non-interactive
```

**Customer app (`mobile/customer`)**

> Note: `mobile/customer` currently has **no `eas.json`** and **no iOS `bundleIdentifier`** in `app.json`.
> Before its first iOS build, the account owner must run `eas build:configure` in `mobile/customer`,
> add `ios.bundleIdentifier`, and complete Part A3 for this project too. After that, the same commands
> as above work inside `mobile/customer`.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| "Do you want to log in to your Apple account?" | Ran without `--non-interactive`, or env vars not loaded | Answer **No**; reopen the terminal; re-run with `--non-interactive` |
| "Not logged in" from `eas whoami` | No Expo login / `EXPO_TOKEN` not loaded | Part B Step 5, then reopen terminal |
| "You don't have access to this project" | Expo account not in the owning organization | Owner invites the account (Part A2) |
| "Distribution certificate / provisioning profile missing" | Credentials not stored on EAS for that profile | Owner runs Part A3 for that profile |
| Preview build won't install on an iPhone | Device not registered | `eas device:create` on that iPhone, then build again |
| "Authentication with App Store Connect API key failed" | Wrong Key ID / Issuer ID / path, or key revoked | Re-check Step 4 values; owner confirms key is active |

---

## Security

- The `.p8` key has **Admin** access to App Store Connect. Treat it like a password.
- It must **never** be in git — `mobile/admin/.gitignore` already ignores `*.p8`; keep it in `C:\keys` or `~/.keys`.
- If a PC is lost or a developer leaves: **revoke** the key in App Store Connect → Integrations, create a new one, update Part A3, and send the new values to the remaining machines. Remove the person from the Expo organization / revoke their robot token. The Apple ID password never has to change.
