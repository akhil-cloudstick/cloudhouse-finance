# CloudHouse Finance: Google Play Submission Guide

App: **CloudHouse Finance** | Package: `com.cloudhouse.app` | Version: `1.0.5` | Build: EAS cloud build or local build (`C:\m`)

**Main link you will use for everything in Parts 4 to 10: https://play.google.com/console**

Menu names in the Play Console sometimes change slightly. If you can't find an item, use the search box at the top of the Console.

---

## Key links

| Purpose | Link |
|---|---|
| Play Console (all steps) | https://play.google.com/console |
| Sign up as a developer | https://play.google.com/console/signup |
| Google Play policy center | https://play.google.com/about/developer-content-policy/ |
| Play App Signing help | https://support.google.com/googleplay/android-developer/answer/9842756 |
| Data safety form help | https://support.google.com/googleplay/android-developer/answer/10787469 |
| Store listing graphics help | https://support.google.com/googleplay/android-developer/answer/9866151 |
| Testing rule for new personal accounts | https://support.google.com/googleplay/android-developer/answer/14151465 |
| Target API level requirement | https://support.google.com/googleplay/android-developer/answer/11926878 |
| D-U-N-S number (organisation accounts) | https://www.dnb.com/duns.html |
| Expo dashboard (EAS builds) | https://expo.dev |
| EAS Build docs | https://docs.expo.dev/build/setup/ |
| Expo versioned docs (this project) | https://docs.expo.dev/versions/v57.0.0/ |

---

## PART 1: Prepare these in advance (checklist)

### 1A. Files and assets
These are uploaded in Part 7 (Console: Grow users, Store presence, Main store listing).

| # | Item | Requirement |
|---|------|-------------|
| 1 | App icon | 512 x 512 px, PNG, max 1 MB (resize `assets/cloudhouse.png`) |
| 2 | Feature graphic | 1024 x 500 px, PNG or JPG, max 15 MB (the banner on the store page) |
| 3 | Phone screenshots | Min **2**, max 8. PNG or JPG, max 8 MB each. Each side 320 to 3840 px. Recommended 1080 x 1920 (9:16). The long side can't be more than 2x the short side. |
| 4 | 7-inch tablet screenshots | Recommended (the app supports tablets). Min 1, max 8. Recommended 1200 x 1920. |
| 5 | 10-inch tablet screenshots | Recommended. Min 1, max 8. Recommended 1600 x 2560. |
| 6 | Promo video (optional) | A YouTube URL |
| 7 | Signed `.aab` file | `app-release.aab` (NOT `.apk`). Built in Part 3A (EAS) or Part 3B (local). |
| 8 | Upload keystore backup | `cloudhouse-release.keystore` and `keystore.properties`, stored in 2 safe places |

**Screenshot ideas (6 to 8):** Login, Dashboard, Customer list, New loan or pledge, KYC upload, QR scan, Reports, Settings.
Use a real phone or emulator, with dummy data only (no real customer data or phone numbers).

### 1B. Text content
Used in Part 7 (Main store listing) and Part 8 (release notes).

| # | Item | Limit |
|---|------|-------|
| 1 | App name | 30 characters: `CloudHouse Finance` |
| 2 | Short description | 80 characters |
| 3 | Full description | 4000 characters |
| 4 | Release notes | 500 characters, e.g. "Initial release" |
| 5 | Support email | Public, shown on the store page |
| 6 | Website (optional) | |
| 7 | **Privacy policy URL** | **Required.** Public page. It must mention camera use, KYC documents and customer data. |

### 1C. Reviewer login (required, because the app needs a login)
Used in Part 6, Step 2 (App access).
- Test username
- Test password
- Short instructions on how to log in
- The test account must work on the production backend

### 1D. Account details
Used in Part 4.
- Google account that the company will own
- $25 registration fee (card)
- Personal accounts: government ID and phone number
- Organisation accounts: D-U-N-S number (https://www.dnb.com/duns.html), a business website and a company address
- Finance or loan license details, if the app offers loans
- EAS build only: an Expo account with access to `cloudhouse-production` (Part 2A)
- Local build only: JDK 17 and Android Studio (Part 2B)

### 1E. Testers (personal accounts only)
Used in Part 8, Step 8.
- 12 or more Gmail addresses for a 14-day closed test (organisation accounts may skip this)

---

## PARTS 2 AND 3: Build the `.aab` (choose ONE way)

| | Option A: EAS cloud build | Option B: Local build |
|---|---|---|
| Setup | Part 2A, Part 3A | Part 2B, Part 3B |
| Needs | Expo account, internet | JDK 17, Android Studio, Gradle, `C:\m` folder |
| Version code | EAS raises it for you | You raise it by hand |
| Speed | 10 to 25 min, queue may add time | Several minutes on your PC |
| Signing | Keystore uploaded to EAS | Keystore in `C:\m` |
| Best for | Easiest, no local tools | No Expo queue, full control |

Pick one. Both give you the same `app-release.aab` for Part 8. Use the same `cloudhouse-release.keystore` either way.

---

## PART 2A: Set up EAS cloud build (one time)

The build runs on Expo's servers, so you do not need Java, Android Studio or Gradle. Run each command in **PowerShell**, in `C:\Users\PC7\Desktop\adithyan\filecorrectionambika\gold-app\mobile`.
Help: https://docs.expo.dev/build/setup/

### Step 1. Check Node
```powershell
node -v
```
Node should be version 18 or newer (20 is recommended).

### Step 2. Install the EAS CLI
```powershell
npm install -g eas-cli
```

### Step 3. Log in to Expo
```powershell
eas login
eas whoami
```
`eas whoami` must show `cloudhouse-production`.

### Step 4. Check the project link
1. Open `app.json` and confirm these values:
   - `"owner": "cloudhouse-production"`
   - `"slug": "cloudhousefinance"`
   - `"package": "com.cloudhouse.app"`
   - `"projectId": "82c9339c-3d9b-43f0-bcc7-8e8cab60ba0a"`
2. Run:
```powershell
eas project:info
```
It must show `@cloudhouse-production/cloudhousefinance`.

### Step 5. Check `eas.json`
- The `production` profile extends `base`, which already sets `EXPO_PUBLIC_API_BASE_URL` to `https://superadmin.cloudhousefinance.com/api/v1`. You do not set it by hand.
- `production` has `autoIncrement: true` and `appVersionSource: remote`, so EAS raises `versionCode` for you on every build.
- Do not use the `development` profile for Play. It builds `com.cloudhouse.app.dev`.
- `production` builds an `.aab` by default. The `preview` profile builds an `.apk` for local testing only.

### Step 6. Set up the Android signing key (one time)
Use the existing upload keystore, so every future update is signed with the same key.
1. Run:
```powershell
eas credentials -p android
```
2. Profile: choose **production**
3. Choose **Keystore: Manage everything needed to build your project**
4. Choose **Set up a new keystore** (or **Upload a keystore** if it asks)
5. Choose to upload your own keystore, not to generate a new one
6. Keystore path: `cloudhouse-release.keystore`
7. Copy the three values from `keystore.properties` when asked:
   - `storePassword`
   - `keyAlias`
   - `keyPassword`
8. Wait for the confirmation that the credentials are saved on EAS.

If you have never uploaded this app to Play, you may let EAS generate a new keystore instead (answer **Yes** when it asks to generate one). Then download and back it up with `eas credentials -p android` (Download existing keystore).

### Step 7. Confirm your files are safe
- Back up `cloudhouse-release.keystore` and `keystore.properties` in 2 places.
- Never commit them to git.
Help: https://docs.expo.dev/app-signing/app-credentials/

---

## PART 3A: Build the `.aab` on EAS

### Step 1. Go to the project folder and install packages
```powershell
cd C:\Users\PC7\Desktop\adithyan\filecorrectionambika\gold-app\mobile
npm install
```

### Step 2. Check the version
- `version` in `app.json` is `1.0.5` (this is the name users see).
- You do not edit `versionCode`. EAS raises it on each production build.
- To see the current value: `eas build:version:get -p android -e production`

### Step 3. Start the build
```powershell
$env:EAS_NO_VCS = "1"
eas build --platform android --profile production
```
If it asks anything about credentials, say you want to use the saved ones from Part 2, Step 6.

### Step 4. Wait for the build
- The CLI prints a link to the build page. Open it to watch the progress.
- It usually takes 10 to 25 minutes, and longer when the queue is busy.
- You can close the terminal. The build keeps running on Expo.

### Step 5. Download the `.aab`
1. Open the build link, or go to https://expo.dev and open the project **cloudhousefinance**, then **Builds**.
2. Click the finished build, then **Download**.
3. Save the file as `app-release.aab`. This is the file you upload in Part 8.

### Step 6. Check the target API level
Google rejects uploads that don't meet its minimum target API level:
https://support.google.com/googleplay/android-developer/answer/11926878
If the Console shows an error about it, update Expo and the project to the latest supported SDK, then rebuild.

### If the build fails
| Error | Fix |
|-------|-----|
| Not logged in, or wrong account | `eas logout`, then `eas login`. `eas whoami` must show `cloudhouse-production`. |
| Keystore or signing error | Redo Part 2 Step 6 and check the 3 values from `keystore.properties`. |
| Wrong backend in the app | Check `EXPO_PUBLIC_API_BASE_URL` under `base` in `eas.json`. |
| Package is `com.cloudhouse.app.dev` | You used the `development` profile. Use `--profile production`. |
| "Install dependencies" step fails | Run `npm install` locally, fix errors, commit the `package-lock.json`, build again. |
| Any other error | Open the build page, then **Logs**, then the failed phase. Search the error at https://docs.expo.dev/build-reference/troubleshooting/ |

### Install-test on a phone (optional)
```powershell
eas build --platform android --profile preview
```
Download the `.apk` from the build page and install it on the phone. Never upload an `.apk` to Play.

### Do not use `eas submit` for the first release
Google requires the first upload to be done by hand in the Play Console. Upload the `.aab` in Part 8. For later updates you can set up `eas submit` with a Google service account.
Help: https://docs.expo.dev/submit/android/

---

## PART 2B: Set up the local build environment (one time)

Run each command in **PowerShell**. The build folder is `C:\m` (a short path avoids the Windows path-too-long error). It must hold a copy of the `gold-app\mobile` project, including the `android` folder.

### Step 1. Check Node and Java
```powershell
node -v
java -version
```
- Node should be version 18 or newer (20 is recommended).
- Java should be **JDK 17**. If it is missing, install Temurin 17 from https://adoptium.net.

### Step 2. Install Android Studio (this gives you the Android SDK)
Download from https://developer.android.com/studio. After installing, open it once so it downloads the SDK.

### Step 3. Set JAVA_HOME
```powershell
# adjust the path to your JDK 17 folder
[Environment]::SetEnvironmentVariable("JAVA_HOME", "C:\Program Files\Eclipse Adoptium\jdk-17.0.x-hotspot", "User")
```

### Step 4. Set ANDROID_HOME (Android SDK)
```powershell
[Environment]::SetEnvironmentVariable("ANDROID_HOME", "$env:LOCALAPPDATA\Android\Sdk", "User")
```

### Step 5. Add the SDK tools to PATH
```powershell
$p = [Environment]::GetEnvironmentVariable("Path","User")
$add = "$env:LOCALAPPDATA\Android\Sdk\platform-tools;$env:LOCALAPPDATA\Android\Sdk\cmdline-tools\latest\bin"
[Environment]::SetEnvironmentVariable("Path", "$p;$add", "User")
```

### Step 6. Close PowerShell and open a new one, then verify
```powershell
echo $env:JAVA_HOME
echo $env:ANDROID_HOME
adb --version
```

### Step 7. Make sure `C:\m\android\local.properties` exists
```powershell
Set-Content C:\m\android\local.properties "sdk.dir=$($env:LOCALAPPDATA -replace '\\','\\')\\Android\\Sdk"
```

### Step 8. Raise the Gradle memory
Open `C:\m\android\gradle.properties` and make sure it contains:
```
org.gradle.jvmargs=-Xmx4g -XX:MaxMetaspaceSize=1g
org.gradle.daemon=true
```

### Step 9. Confirm the signing files are in place
```powershell
dir C:\m\cloudhouse-release.keystore
dir C:\m\keystore.properties
```
If either is missing, copy them from the original project:
```powershell
copy C:\Users\PC7\Desktop\adithyan\filecorrectionambika\gold-app\mobile\cloudhouse-release.keystore C:\m\
copy C:\Users\PC7\Desktop\adithyan\filecorrectionambika\gold-app\mobile\keystore.properties C:\m\
```
`keystore.properties` must contain `storeFile`, `keyAlias`, `storePassword` and `keyPassword`.
Help: https://developer.android.com/studio/publish/app-signing

---

## PART 3B: Build the `.aab` locally

### Step 1. Go to the project root and install packages
```powershell
cd C:\m
npm install
```

### Step 2. Set the production API URL for this PowerShell session
This is important. The URL lives in `eas.json`, which a local Gradle build doesn't read. Without this line, the app may bundle the wrong backend.
```powershell
$env:EXPO_PUBLIC_API_BASE_URL = "https://superadmin.cloudhousefinance.com/api/v1"
$env:NODE_ENV = "production"
```
Do not set `APP_VARIANT=development`, or the package becomes `com.cloudhouse.app.dev`.

### Step 3. Check the version
Open `C:\m\android\app\build.gradle` and check:
```
versionCode 1        <- must be higher than the last upload (2, 3, 4 ...)
versionName "1.0.5"
```

### Step 4. Check the target API level
Open `C:\m\android\build.gradle` and look at `targetSdkVersion`. It must meet Google's current minimum:
https://support.google.com/googleplay/android-developer/answer/11926878

### Step 5. Clean and build
```powershell
cd C:\m\android
.\gradlew clean
.\gradlew bundleRelease
```
Don't use `assembleRelease`. That produces an `.apk`.

### Step 6. Wait for `BUILD SUCCESSFUL` (several minutes).

### Step 7. Your upload file is here
```
C:\m\android\app\build\outputs\bundle\release\app-release.aab
```
The folder is `bundle\release`, not `apk\release`.

### Step 8. Verify it is signed with the release key (optional)
```powershell
keytool -printcert -jarfile C:\m\android\app\build\outputs\bundle\release\app-release.aab
```
The owner must not be "Android Debug".

### If the local build fails
| Error | Fix |
|-------|-----|
| keystore not found, or a signing error | Do Part 2B Step 9. The keystore must sit one folder above `android`. |
| Out of memory | Raise `-Xmx` in `gradle.properties` (Part 2B Step 8). |
| `JAVA_HOME` is not set | Redo Part 2B Steps 3 and 6. |
| `SDK location not found` | Redo Part 2B Step 7. |
| Path too long (Windows) | Keep the project in `C:\m`. |
| Stale cache | `.\gradlew clean`, then delete `C:\m\android\.gradle` and `C:\m\android\app\build`, then rebuild. |

### Install-test the release build (optional, on a phone)
```powershell
cd C:\m\android
.\gradlew assembleRelease
adb install -r app\build\outputs\apk\release\app-release.apk
```
The `.apk` is for local testing only. Never upload it to Play.

---

## PART 4: Create the Play Console account

**Website:** https://play.google.com/console/signup

1. Open the link above and sign in with the company Google account.
2. Choose **Organisation** (recommended for a finance app) or **Personal**.
3. Enter the developer name, email and phone number. The name is public.
4. Pay the one-time **$25** fee.
5. Complete identity verification (ID, address, D-U-N-S for organisations).
6. Wait for the approval email, which takes 1 to 7 days. You can't create an app until then.
7. After approval, sign in at https://play.google.com/console. You will see **All apps**.

---

## PART 5: Create the app

**Where:** https://play.google.com/console, then **All apps**, then the blue **Create app** button (top right).

1. Click **Create app**.
2. **App name:** `CloudHouse Finance`
3. **Default language:** English
4. **App or game:** App
5. **Free or paid:** Free (can't be changed later)
6. Tick **Developer Program Policies** and **US export laws**.
7. Click **Create app**.
8. You land on the app **Dashboard**. It lists the setup tasks.

---

## PART 6: Complete the setup tasks

**Where:** left menu, **Dashboard**, then the **Set up your app** card. Or: left menu, **Policy and programs**, then **App content**.
Policy help: https://play.google.com/about/developer-content-policy/

1. **Privacy policy**
   - Where: App content, **Privacy policy**, then **Start** or **Manage**.
   - Enter the public URL, then click **Save**.
2. **App access**
   - Where: App content, **App access**, then **Manage**.
   - Choose "All or some functionality is restricted", then **Add new instructions**.
   - Add the test username, password and login steps from section 1C, then **Save**.
3. **Ads**
   - Where: App content, **Ads**.
   - Choose "No, my app does not contain ads", unless it does, then **Save**.
4. **Content rating**
   - Where: App content, **Content rating**, then **Start questionnaire**.
   - Enter the email, choose the category "Utility, productivity, communication or other", answer the questions honestly, then **Submit**.
5. **Target audience and content**
   - Where: App content, **Target audience**.
   - Choose **18 and over**, then **Save**.
6. **Data safety**
   - Where: App content, **Data safety**, then **Start**.
   - Help: https://support.google.com/googleplay/android-developer/answer/10787469
   - Declare these, and say whether they are collected, shared, or both:
     - Photos (KYC documents)
     - Camera (QR scanning and KYC)
     - Name, phone and address (customer data)
     - Financial info (loans and gold)
     - Encrypted in transit: Yes (HTTPS)
     - Account or data deletion method
   - Click **Save**, then **Submit**.
7. **Financial features**
   - Where: App content, **Financial features**.
   - Declare what applies, such as loans, or choose "My app doesn't provide any financial features".
8. **Government apps, news apps, health apps, COVID-19**
   - Where: App content.
   - Answer No to each, if they don't apply.
9. **Store settings (category and contact)**
   - Where: left menu, **Grow users**, then **Store presence**, then **Store settings**.
   - **App category:** App, then **Finance**
   - **Contact details:** email (public), phone and website are optional
   - Click **Save**.

---

## PART 7: Store listing

**Where:** left menu, **Grow users**, then **Store presence**, then **Main store listing**.
Graphics help: https://support.google.com/googleplay/android-developer/answer/9866151

1. Enter the **short description** (80 characters) and the **full description** (4000 characters).
2. **App icon:** upload the 512 x 512 PNG.
3. **Feature graphic:** upload the 1024 x 500 image.
4. **Phone screenshots:** upload at least 2.
5. **7-inch tablet screenshots** and **10-inch tablet screenshots:** upload them (recommended).
6. Click **Save**.

---

## PART 8: Upload and test

**Where:** left menu, **Test and release**, then **Testing**, then **Internal testing**.
App signing help: https://support.google.com/googleplay/android-developer/answer/9842756

1. Click **Create new release**.
2. Under **App signing**, accept **Play App Signing** (Google-generated key). If you see **Continue**, click it.
3. Under **App bundles**, click **Upload** and select your `app-release.aab`: the one downloaded from EAS (Part 3A, Step 5) or the local one at `C:\m\android\app\build\outputs\bundle\release\app-release.aab` (Part 3B, Step 7).
4. Wait for the upload and processing to finish.
5. Enter the **Release name** `1 (1.0.5)` and the **Release notes** (e.g. "Initial release").
6. Click **Next**. If you see errors, fix them. Warnings can usually be accepted.
7. Click **Save and publish**.
8. **Add testers:**
   - Open the **Testers** tab on the same page.
   - Click **Create email list**, add your Gmail addresses, and save.
   - Copy the **opt-in URL** and open it on a phone (signed in with a tester Gmail).
   - Install the app from the Play Store link.
9. Test login, camera, QR scan, image upload and all main screens.
10. **Personal accounts only (created after November 2023):**
    - Rule: https://support.google.com/googleplay/android-developer/answer/14151465
    - Where: left menu, **Test and release**, **Testing**, **Closed testing**, **Create track**.
    - Upload the same `.aab`, add 12 or more tester emails, and click **Save and publish**.
    - All testers must opt in and stay opted in for **14 continuous days**.
    - Then go to **Dashboard** and click **Apply for production**.

Organisation accounts can skip step 10.

---

## PART 9: Release to production

**Where:** left menu, **Test and release**, then **Production**.

1. Click the **Countries / regions** tab, then **Add countries / regions**. Select India (or your countries), then **Save**.
2. Click **Create new release**.
3. Under **App bundles**, click **Add from library** and select the `.aab` you uploaded earlier. If it isn't listed, click **Upload**.
4. Enter the release notes.
5. Click **Next**. Fix all errors.
6. Click **Save**, then go to **Publishing overview** (left menu, **Publishing overview**) and click **Send changes for review**.
7. Confirm.

---

## PART 10: After submission

**Where:** left menu, **Publishing overview** shows the review status.

1. Status shows "In review". Review takes 1 to 7 days (longer for new accounts). You get an email with the result.
2. If the app is rejected:
   - Open **Policy and programs**, then **Policy status**, or read the email.
   - Fix the issue, raise `versionCode` (local build only, EAS does it for you), build a new `.aab` (Part 3A or 3B) and upload it again.
   - Common causes:
     - Privacy policy missing or incomplete
     - The reviewer can't log in (Part 6, Step 2)
     - Data safety form doesn't match what the app does
     - A crash on launch
3. After approval, the app is live at:
   `https://play.google.com/store/apps/details?id=com.cloudhouse.app`
4. Monitor crashes and ratings under **Monitor and improve** (left menu), then **Android vitals** and **Ratings and reviews**.

### For every update
1. Optionally raise `version` in `app.json`.
2. EAS build: EAS raises `versionCode` for you, then redo Part 3A (Steps 3 to 5).
   Local build: raise `versionCode` in `C:\m\android\app\build.gradle`, then redo Part 3B (Steps 2 to 7).
3. Console: **Test and release**, **Production**, **Create new release**, upload the `.aab`, then **Next** and **Save**. Then **Publishing overview**, then **Send changes for review**.

---

## Do not forget
- Use the same `cloudhouse-release.keystore` for every update.
- Back up the keystore and `keystore.properties`. If you lose them, you can't update the app without a Play support key reset.
- Never commit the keystore or `keystore.properties` to git.
- Only the `.aab` goes to Play. The `.apk` is for local testing.
