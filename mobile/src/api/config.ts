// Single place to change the backend base URL. Per the plan's "online-only,
// no offline mode" decision, the app always talks to this URL live — there's
// no local proxy layer like the web app's single-port dev workflow, since a
// device/emulator can't reach the Go binary via a Next.js proxy the way the
// browser does. Point this at your machine's LAN IP (not localhost — the
// Android emulator/device is a separate host) while developing, e.g.
// "http://192.168.1.23:8080/api/v1".
export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://10.0.2.2:8080/api/v1";
// 10.0.2.2 is the Android emulator's alias for the host machine's localhost —
// works out of the box in the emulator; a physical device needs the LAN IP
// above instead (set EXPO_PUBLIC_API_BASE_URL in .env.local or eas.json).
