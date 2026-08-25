# Ambika Gold Finance — Customer App (Batch 1)

Android-only Expo (React Native + expo-router) app for customer self-service. This is **Batch 1**: bottom-nav shell, OTP + biometric login, Home/Dashboard, and a Gold Rates rise-up modal. See the full batch plan for context and what's still to come (My Loans, Payments, Documents, Profile & KYC, Notifications, More).

## Running it

```bash
cd customer-mobile
npm install
npx expo start
```

Press `a` to launch on a connected Android emulator/device, or scan the QR code with Expo Go.

Unlike the web admin (`frontend/`), there's no single-port dev proxy here — the app always talks to the Go backend directly over HTTP, since a device/emulator can't reach it via a Next.js-style proxy the way a browser does. Point it at your machine by setting `EXPO_PUBLIC_API_BASE_URL` in a `.env.local` file (Expo picks up `EXPO_PUBLIC_*` vars automatically):

```
EXPO_PUBLIC_API_BASE_URL=http://192.168.1.23:8080/api/v1/customer
```

- **Android emulator**: the default (`http://10.0.2.2:8080/api/v1/customer`) already works out of the box — `10.0.2.2` is the emulator's alias for your machine's `localhost`.
- **Physical device**: set `EXPO_PUBLIC_API_BASE_URL` to your machine's LAN IP instead — the device is a separate host on the network.

Make sure the backend is running (`cd backend && go run .`) and migrated (`go run ./cmd/migrate`), and that a WhatsApp/OpenWA sender is configured under the staff web app's Settings > WhatsApp page — OTP delivery for this app goes out over that same integration.

## What's implemented (Batch 1)

- Bottom nav: Home (real), My Loans / Payments / Documents / More (ComingSoon stubs, real routes already wired for later batches).
- Login: phone -> OTP (via WhatsApp) -> session JWT, with an attempt afterward to register the device for biometric quick sign-in (`expo-local-authentication` + a server-issued device token). OTP sign-in always remains available as the fallback.
- Home: 24K gold rate widget (tap opens a rise-up modal with recent history), a notification bell that opens a ComingSoon bottom sheet (not a route), and placeholder loan/reminder cards.

## Conventions

Mirrors `mobile/` (the staff app) closely: same theme (`src/theme/colors.ts`, `typography.ts`), same component set (`ThemedText`, `Card`, `GoldButton`, `GoldTextInput`, `BottomSheetModal`/`SheetHost`, `Icon`, `FloatingHeader`, `AppTabBar`), same `apiRequest` fetch-wrapper pattern in `src/api/client.ts`. The customer JWT scheme (`type: "customer"`) and its middleware are entirely separate from the staff app's — a customer token is never valid on a staff route and vice versa.
