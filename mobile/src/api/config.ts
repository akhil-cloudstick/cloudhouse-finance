// The backend. Per the plan's "online-only, no offline mode" decision, the
// app always talks to this server live: golddemo.cloudhousefinance.com.
// EXPO_PUBLIC_API_BASE_URL (.env.local for `expo start`, eas.json's `base`
// profile for EAS builds) is set to this same address everywhere; it exists
// only so a different environment could be pointed elsewhere on purpose.
export const BACKEND_URL = "https://golddemo.cloudhousefinance.com/api/v1";
export const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || BACKEND_URL;

// The server root, i.e. API_BASE_URL without its "/api/v1" suffix. Uploaded
// files come back as server-root-relative paths ("/uploads/<id>-<name>",
// see backend/internal/upload/handler.go) and are served by a static route
// mounted outside the API group — so displaying one means joining it to the
// ORIGIN, not to API_BASE_URL, which would produce "/api/v1/uploads/...".
export const API_ORIGIN = API_BASE_URL.replace(/\/api\/v\d+\/?$/, "");
