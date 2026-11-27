# Mobile builds: CloudHouse Finance (admin) and CloudHouse Finance Customer (customer)

Builds run on **GitHub Actions** (`.github/workflows/mobile.yml`) with `eas build --local`, so they use **no EAS build credits**. This is the same setup as CloudHouse ERP Mobile and the POS apps. This repo is `akhil-cloudstick/CloudHouse-Finance-Mobile` (`origin`). GitLab `gold-app` keeps a backup copy, which you push yourself.

| | Admin | Customer |
|---|---|---|
| Folder | `admin/` | `customer/` |
| App / id | CloudHouse Finance · `com.cloudhouse.app` | CloudHouse Finance Customer · `com.cloudhouse.customer` |
| Dev app / id | CloudHouse Finance (Dev) · `com.cloudhouse.app.dev` | CloudHouse Finance Customer (Dev) · `com.cloudhouse.customer.dev` |
| Expo organisation | cloudhouse-production | cloudhouse-production |
| Android download (always the newest) | https://github.com/akhil-cloudstick/cloudhouse-finance-releases/releases/download/admin-latest/cloudhouse-finance.apk | https://github.com/akhil-cloudstick/cloudhouse-finance-releases/releases/download/customer-latest/cloudhouse-customer.apk |

## How users get a new version
- **Android:** each **preview** build replaces the APK behind the links above. Installed apps check `latest.json` when they start and when they come back to the front. If it lists a higher `version`, the app shows **New version → Download → Install** and Android installs it over the old app, keeping the data. The update can also be opened by hand: admin under **Profile (avatar) → App update**, customer on the **Profile** tab.
- **iPhone:** the same prompt opens TestFlight, where the user taps **Update**.
- There are no over-the-air updates: every change ships as a new build.

## One-time setup

### 1. GitHub
1. Create the **public** repo `akhil-cloudstick/cloudhouse-finance-releases` with only a README. It hosts the APK downloads, and it must be public so phones can download without logging in.
2. Push `main`. The **Run workflow** button only appears once `.github/workflows/mobile.yml` is on the default branch.
3. **CloudHouse-Finance-Mobile → Settings → Secrets and variables → Actions**

   | Name | Kind | Value |
   |---|---|---|
   | `EXPO_TOKEN` | Secret | expo.dev → **cloudhouse-production** → Settings → Access tokens → **Add robot** (role Developer) → token. One token for both apps (and POS, ERP). |
   | `RELEASES_TOKEN` | Secret | GitHub → Settings → Developer settings → **Fine-grained tokens** → only `cloudhouse-finance-releases` → **Contents: Read and write** |
   | `ASC_API_KEY_P8` | Secret (optional) | The App Store Connect `.p8` key, base64: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("AuthKey.p8"))`. Without it, uploads use the key stored on EAS. |
   | `ASC_KEY_ID`, `ASC_ISSUER_ID` | Variables (optional) | Only if the key changes. The defaults are the current key's. |
   | `TESTFLIGHT_URL_ADMIN`, `TESTFLIGHT_URL_CUSTOMER` | Variables | Public TestFlight links (`https://testflight.apple.com/join/…`) |
   | `TESTFLIGHT_DEV_URL_ADMIN`, `TESTFLIGHT_DEV_URL_CUSTOMER` | Variables | TestFlight links of the Dev apps, if they have one |

### 2. EAS credentials, once per app id
Run these in each app folder. Set `$env:APP_VARIANT = "development"` **in that terminal** before you configure a Dev app, and check that the screen shows the id ending in **`.dev`**.
```powershell
npx eas-cli@latest credentials -p android   # profile development → Keystore → Set up a new keystore (Dev apps)
npx eas-cli@latest credentials -p ios       # profile development-testflight / preview-testflight → Build Credentials → All
```
What still needs credentials:
- `com.cloudhouse.customer` on iOS: the customer app is new on iPhone.
- `com.cloudhouse.customer.dev` on Android and iOS.
- `com.cloudhouse.app.dev`: check what already exists, since the old development profile already used this id.

### 3. App Store Connect
Create **CloudHouse Finance Customer** (`com.cloudhouse.customer`), **CloudHouse Finance Customer Dev** (`com.cloudhouse.customer.dev`) and, if it does not exist yet, **CloudHouse Finance Dev** (`com.cloudhouse.app.dev`). Copy each app's **Apple ID** number into `eas.json` → `submit` → `…` → `ios.ascAppId`. The admin app's number (`6830677656`) is already filled in.

## Running a build
GitHub → **CloudHouse-Finance-Mobile** → **Actions** → **Mobile build** → **Run workflow**:

| Input | Choices |
|---|---|
| app | `admin` / `customer` |
| platform | `all` / `android` / `ios` |
| profile | `preview` (real app) / `development` (Dev app) / `production` (stores) |

| Profile | Android result | iPhone result |
|---|---|---|
| preview | APK at the stable link (release `<app>-latest`), plus a kept copy in release `<app>-v<version>` | TestFlight build of the real app |
| development | Dev APK in release `<app>-dev` and on the run page → Artifacts | TestFlight build of the Dev app |
| production | AAB on the run page → Artifacts; upload it in Play Console | Uploaded to App Store Connect; submit it for review there |

GitHub's free plan gives 2,000 minutes a month, and macOS minutes count 10×, so use iPhone builds sparingly.

## Every release
1. Raise `expo.version` in that app's `app.json`. Apps offer a build only when its version is **higher** than the installed one.
2. Commit and push here (`git push origin main`), and push the GitLab backup.
3. Run the workflow: **preview** for testers and users, **production** for the stores.

## Developer app (Dev)
Rebuild it only after a native change (a new library, a permission, `app.json`). Normal code loads from your PC:
```powershell
npx expo start --dev-client
```
