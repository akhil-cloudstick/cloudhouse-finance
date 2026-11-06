# iOS Build and TestFlight Guide (CloudHouse Finance)

How to build the iOS app with EAS and send it to TestFlight, without anyone logging in to the Apple Developer account.

## Overview

| | Dev app | Production app |
|---|---|---|
| EAS profile | `development` | `production` |
| App name | CloudHouse Finance (Dev) | CloudHouse Finance |
| Bundle ID | `com.cloudhouse.app.dev` | `com.cloudhouse.app` |
| Distribution | TestFlight (store) | TestFlight / App Store |

- EAS project: `@cloudhouse-production/cloudhousefinance`
- Apple team: CLOUDHOUSE TECHNOLOGIES PRIVATE LIMITED (`N7X7Q2H8V8`)
- The dev suffix comes from `app.config.js`. The `development` profile in `eas.json` sets `APP_VARIANT=development`.
- Both apps can be installed on the same phone.

Signing is done with an **App Store Connect API key** (a `.p8` file). It replaces an Apple ID login.

---

## Part 1: Every developer (day-to-day builds)

The signing certificate and provisioning profile are already stored on Expo for this project. You do not need the Apple account, the `.p8` file or any key to build.

1. Accept the Expo invite for the `cloudhouse-production` organization and sign in to expo.dev.
2. Install Node.js LTS, then:
   ```powershell
   npm install -g eas-cli
   eas login
   eas whoami      # must list cloudhouse-production
   ```
3. Pull the latest code. `app.json` must have `"owner": "cloudhouse-production"` and a projectId. Check:
   ```powershell
   cd gold-app/mobile
   eas project:info     # @cloudhouse-production/cloudhousefinance
   ```
4. Build:
   ```powershell
   $env:EAS_NO_VCS = "1"      # optional: build the working folder without committing
   eas build --profile development --platform ios
   eas build --profile production --platform ios
   ```
   Answer **no** to any "Do you want to log in to your Apple account?" question. If you are asked that after the one-time setup is done, stop and tell the admin.

---

## Part 2: Send a build to TestFlight

The app record must already exist in App Store Connect for each bundle ID (see Part 3, step 6).

```powershell
eas submit --platform ios --profile development
eas submit --platform ios --profile production
```

Submit uses the API key. You can give it either way:
- It is stored on Expo for the project (set up in Part 3), or
- The admin gives you `AuthKey_<KEYID>.p8`. Save it as `gold-app/mobile/certs/AuthKey.p8`. `eas.json` points to this path.

Do not commit the `.p8` file. `certs/` and `*.p8` are in `.gitignore`.

---

## Part 3: One-time setup (done once, by one person)

Values for this project (the Apple admin already issued the key):
- Key file: `AuthKey_9289TXK48L.p8` (ask the admin for it; save as `gold-app/mobile/certs/AuthKey.p8`)
- Key ID: `9289TXK48L`
- Issuer ID: `204e739c-06da-439b-8cc1-bbaa914fcf38`
- Team ID: `N7X7Q2H8V8` (Organization), key type: Team key, role: Admin

Steps:

1. **Update the CLI and open credentials** from `gold-app/mobile`:
   ```powershell
   npm install -g eas-cli
   eas credentials -p ios
   ```
2. Choose the build profile (`development` first), then choose Company/Organization if asked about the team type.
3. **Store the API key.**
   - Choose **App Store Connect: Manage your API Key**, then **Add a new API Key For EAS Submit**.
   - "Generate a new key?": **no**.
   - Key type: **Team key**.
   - Path to the key: `certs/AuthKey.p8`.
   - Key ID: `9289TXK48L`
   - Issuer ID: `204e739c-06da-439b-8cc1-bbaa914fcf38` (type it, do not paste)
   - "Do you want the project to use the new API Key?": **yes**.
   - You will see a message that it could not validate the key because you are not authenticated with Apple. This is only a warning.
4. **Create the signing credentials.**
   - Go back to the main menu, choose **Build Credentials: Manage everything needed to build your project**, then **All: Set up all the required credentials to build your project**.
   - EAS registers the bundle ID with the API key, so no Apple ID prompt appears.
   - "Reuse this distribution certificate?": **yes** (the company certificate, valid until Oct 2027).
   - "Generate a new Apple Provisioning Profile?": **yes**.
   - You should end on "All credentials are ready to build".
5. **Repeat steps 2 to 4 for the `production` profile.** It uses `com.cloudhouse.app`.
6. **Ask the admin to create the apps in App Store Connect** (My Apps → +):
   - CloudHouse Finance (Dev), bundle ID `com.cloudhouse.app.dev`
   - CloudHouse Finance, bundle ID `com.cloudhouse.app`

   Without these, `eas submit` fails.

Always answer **no** to "Do you want to log in to your Apple account?" if you want to avoid using the Apple ID.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `Owner of project ... does not match owner` | `app.json` `owner` and `extra.eas.projectId` must belong to the same account. Use `cloudhouse-production`. |
| A build asks to log in to Apple | The one-time setup (Part 3) is incomplete for that profile. Finish it. |
| The Apple login uses a cached session without asking | The Apple session cookie is cached at `C:\Users\<you>\.app-store`. Delete that folder to clear it. |
| `Invalid ... Issuer ID ... should be a valid UUID` | The value was mistyped or a character was lost in the paste. Type it again with no spaces, or ask the admin to resend it from Team Keys. |
| The terminal freezes or paste shows nothing | Kill the terminal and open a new one. Paste with Ctrl+Shift+V or right-click, or type the value. |
| `Credentials are not set up. Run this command again in interactive mode.` | You used `--non-interactive` before the credentials existed. Run Part 3 in interactive mode first. |
| `eas build` complains about uncommitted changes | Set `$env:EAS_NO_VCS = "1"` for that terminal, or commit. |
| A new phone cannot install the dev app | TestFlight builds do not need device registration. Invite the person as a TestFlight tester in App Store Connect. |

---

## Security notes

- The `.p8` key is a secret. Share it only through a secure channel such as a password manager. Never post it in chat or email or commit it.
- If it is exposed, the admin should revoke it in App Store Connect and issue a new one, then repeat Part 3 steps 3 to 4.
- The Key ID, Issuer ID and Team ID are not secret.
