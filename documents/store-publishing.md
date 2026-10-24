# Store publishing: answers and checklist

Written for whoever fills in Google Play Console and App Store Connect for the two apps. Prepared 2026-10-23 from the code, not from a lawyer. Store requirements change; check the official Play Console and App Store Connect help pages before submitting.

| | Customer app | Staff app |
|---|---|---|
| Name in app.json | CloudHouse | CloudHouse Staff |
| Android package | `com.cloudhouse.customer` | `com.cloudhouse.app` |
| iOS bundle id | none (`platforms: ["android"]`) | `com.cloudhouse.app` |
| Stores | Google Play only | Google Play + App Store |
| Version | 1.0.0 | 1.0.0 |

The customer app has no iOS target, so every Apple step applies to the staff app only.

## 1. URLs to paste (replace `<domain>` with the production domain)

| Console field | Customer app | Staff app |
|---|---|---|
| Privacy policy URL (Play + Apple) | `https://<domain>/customer-app/privacy-policy` | `https://<domain>/staff-app/privacy-policy` |
| Account deletion URL (Play) | `https://<domain>/customer-app/account-deletion` | `https://<domain>/staff-app/account-deletion` |
| Support URL (Apple) / Website (Play) | `https://<domain>/customer-app/contact` | `https://<domain>/staff-app/contact` |

The URLs must open from outside your network without login. Test them from a phone on mobile data after deploying.

## 2. Google Play: Data safety form (answers)

Facts: both apps use HTTPS only, keep sign-in tokens in secure storage, and use no analytics, ads, crash-reporting or push-notification SDK (checked in `package.json`; no Firebase, Sentry, analytics or `expo-notifications`). Re-check this before every release.

**Customer app**

| Question | Answer |
|---|---|
| Does the app collect or share user data? | Yes |
| Is all data encrypted in transit? | Yes |
| Can users request data deletion? | Yes, by email/phone request (URL above) |
| Personal info: name, phone number, address | Collected; not shared for ads; purpose: app functionality, account management |
| Personal info: government ID numbers (KYC) | Collected; purpose: app functionality, compliance |
| Financial info: payment info / loan and payment history | Collected; payment details are processed by Razorpay (disclose Razorpay as a recipient); purpose: app functionality |
| App activity, location, contacts, photos, files, audio | Not collected |
| Device or other IDs (advertising ID) | Not collected |
| Is data optional? | No (needed to use the app) |

**Staff app** (differences)

| Question | Answer |
|---|---|
| Photos and videos | Collected (KYC document photos); purpose: app functionality |
| Files and docs | Collected (uploaded documents); purpose: app functionality |
| Personal info and financial info | Collected (customer records staff enter) |
| Camera permission | Used to scan QR codes and photograph KYC documents |

## 3. Apple: App Privacy ("nutrition label") for the staff app

- Data used to track you: none.
- Data linked to you: name, phone number, address, government ID, financial info (loan and payment records), photos, user content (documents). Purpose for all: app functionality.
- Third-party partners whose code is in the app: none that collect data. List any you add later.

## 4. Permissions justification (Play and Apple)

| Permission | App | Reason to enter |
|---|---|---|
| Camera | Staff | Scan business and packet QR codes; photograph KYC documents |
| Photo library | Staff | Attach KYC documents the user selects |
| Biometric | Customer | Optional fingerprint/face unlock; data stays on the device |
| Internet | Both | Load account data; Razorpay checkout (customer) |

Camera and photo wording in `app.json` already matches. Do not request permissions the apps do not use.

## 5. Ratings and declarations

- **Content rating (Play) / age rating (Apple):** answer "no" to violence, sexual content, gambling, user-generated public content. The apps are financial tools. Expect an everyone/18+ style result; answer accurately.
- **Target audience:** adults only (18+). Do not tick "includes children".
- **Ads declaration:** "No, my app does not contain ads."
- **App category:** Finance (Play) / Finance (Apple).
- **Financial features declaration (Play):** the apps show loan information and take loan repayments. Read Play's current "Financial services" declaration and answer for a loan-management app: they do not originate loans in the app, and the lender is the business. Confirm the exact wording with the console form.
- **Government / health / news declarations:** not applicable.

## 6. Reviewer access (most common reason for rejection)

The customer app signs in by OTP and the staff app by login, so a reviewer cannot get in without help.

- Create one **test business** and one test staff login, and one test customer whose OTP is not needed or is fixed for review. Put the credentials in Play Console → App access, and in App Store Connect → App Review Information → Notes.
- Keep the test business free of real customer data.
- Suggested note: "Sign in with the credentials above. The app is a loan-management tool for gold-loan businesses; accounts are created by the business, not in the app."

## 7. Store listing text and assets

- **Title** (30 chars max on Play): "CloudHouse" / "CloudHouse Staff".
- **Short description** (80 chars): "View your gold loans, dues and payments in one place." (customer) / "Manage gold loans, customers and payments on the go." (staff).
- **Full description:** what it does, who it is for ("for customers of businesses using CloudHouse"), and no claims you cannot back (no "guaranteed", no rates).
- **Icon** 512×512 (Play), 1024×1024 (Apple); both exist as `assets/*.png` per app: check sizes.
- **Screenshots:** real screens, not splash or logo screens (stores reject those). Phone sizes required; tablet only if `supportsTablet` is true (staff iOS is true: provide iPad screenshots or set it to false).
- **Feature graphic** 1024×500 (Play only).
- **Contact email** (Play, required): the support email entered on the default business.

## 8. Account and build tasks

- **Play developer account:** government ID and a payment card in the legal name; an organisation account needs a D-U-N-S number (up to 30 days).
- **Personal Play accounts created after 13 Nov 2023:** closed testing with 12 testers over 14 continuous days before publishing. Check which account type you have.
- **Apple Developer Program** enrolment; App Store Connect app record with the bundle id.
- **Target API level (Play):** the SDK Expo uses must meet Play's current minimum. Check before the build.
- **Apple SDK minimum:** from April 2027 apps must be built with the iOS 27 SDK and target iOS 15+.
- **Play App Signing:** accept, and keep the upload key safe.
- **Build:** `eas build` (see `mobile/eas.json`); customer app has no `eas.json`: add one before building.
- **Version:** bump `version` and the build/versionCode for every upload.

## 9. Before pressing submit

1. Deploy the backend and the rebuilt frontend; the legal URLs return 200 signed out.
2. Fill the default business's name, legal name, address, phone, website and **support email** (Settings → Business Profile).
3. Have the legal text reviewed; confirm the placeholders in `frontend/modules/legal/content/legalConfig.ts` (retention years, reply days, courts).
4. Check the Privacy Policy matches the Data safety answers above word for word in substance.
5. Install the release build on a real phone and walk through the reviewer login.
6. Confirm Razorpay is on live keys for the customer app, and that the merchant account is approved.
