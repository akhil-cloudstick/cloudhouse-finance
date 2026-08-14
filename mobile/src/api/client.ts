import { API_BASE_URL } from "./config";
import { getToken } from "../auth/tokenStorage";

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

// Every list screen/dropdown/search box in this app must go through this
// helper with its filters as `params` — never fetch a full list and filter
// on-device (see plan: "All filtering/searching/sorting/dropdown-population
// happens server-side").
export function toQueryString(params?: Record<string, string | number | boolean | undefined>): string {
  if (!params) return "";
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== "");
  if (entries.length === 0) return "";
  const usp = new URLSearchParams();
  for (const [k, v] of entries) usp.set(k, String(v));
  return `?${usp.toString()}`;
}

type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  params?: Record<string, string | number | boolean | undefined>;
  // auth/login/forgot-password/reset-password are the only public routes.
  skipAuth?: boolean;
};

export async function apiRequest<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, params, skipAuth } = opts;
  const url = `${API_BASE_URL}${path}${toQueryString(params)}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    // Free ngrok tunnels serve an HTML "visitor warning" interstitial to any
    // request that doesn't look like a browser, which would otherwise break
    // every API call through a free ngrok URL (see EXPO_PUBLIC_API_BASE_URL
    // in .env.local). Harmless no-op against a plain LAN IP/localhost.
    "ngrok-skip-browser-warning": "true",
  };
  if (!skipAuth) {
    const token = await getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;

  if (!res.ok) {
    const message = (data && (data.error || data.message)) || res.statusText;
    throw new ApiError(res.status, message, data);
  }

  return data as T;
}
