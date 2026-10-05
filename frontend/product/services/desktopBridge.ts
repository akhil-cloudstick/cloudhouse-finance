/* The only file that touches the desktop runtime (Wails). Everything else asks
 * this one, so the same bundle runs in a browser, where every call degrades to
 * a value instead of throwing. */

export type UpdateEventName =
  | "checking"
  | "available"
  | "not-available"
  | "progress"
  | "downloaded"
  | "error";

export type UpdateEventPayload = {
  version?: string;
  percent?: number;
  message?: string;
};

export type BridgeResult = { ok: boolean; reason?: string };

export type DesktopPlatform = "win" | "mac" | "linux" | "web";

/* Wails injects its runtime only into the first page of a dev session, but every
 * page of the desktop window shares one origin, so later pages load it themselves.
 * Inline in <head>; does nothing in a browser or in the packaged app. */
export const DESKTOP_RUNTIME_LOADER = `if(location.hostname==="wails.localhost"&&!window.go){document.write('<script src="/wails/runtime.js"></'+'script><script src="/wails/ipc.js"></'+'script>')}`;

const NOT_IN_BROWSER = "not available in the browser";

const noop = () => {};

function app(): DesktopApp | null {
  if (typeof window === "undefined") return null;
  return window.go?.main?.App ?? null;
}

export function isDesktop(): boolean {
  return app() !== null && typeof window.runtime?.EventsOn === "function";
}

export function platform(): DesktopPlatform {
  if (!isDesktop()) return "web";
  const ua = navigator.userAgent;
  if (ua.includes("Windows")) return "win";
  if (ua.includes("Mac")) return "mac";
  return "linux";
}

export async function appVersion(): Promise<string | null> {
  const native = app();
  if (!native) return null;
  try {
    return await native.Version();
  } catch {
    return null;
  }
}

/* True when the native window has no frame of its own, so the page draws the title bar. */
export async function hasCustomTitleBar(): Promise<boolean> {
  const native = app();
  if (!native) return false;
  try {
    return await native.Frameless();
  } catch {
    return false;
  }
}

export const windowControls = {
  minimise: () => window.runtime?.WindowMinimise(),
  toggleMaximise: () => window.runtime?.WindowToggleMaximise(),
  close: () => window.runtime?.Quit(),
  isMaximised: async (): Promise<boolean> => {
    try {
      return (await window.runtime?.WindowIsMaximised()) ?? false;
    } catch {
      return false;
    }
  },
};

async function call(run: (native: DesktopApp) => Promise<void>): Promise<BridgeResult> {
  const native = app();
  if (!native) return { ok: false, reason: NOT_IN_BROWSER };
  try {
    await run(native);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

export function checkForUpdate(): Promise<BridgeResult> {
  return call((n) => n.CheckUpdate());
}

export function downloadUpdate(): Promise<BridgeResult> {
  return call((n) => n.DownloadUpdate());
}

export function installUpdate(): Promise<BridgeResult> {
  return call((n) => n.InstallUpdate());
}

export function onUpdateEvent(
  name: UpdateEventName,
  handler: (payload: UpdateEventPayload) => void,
): () => void {
  if (!isDesktop() || !window.runtime) return noop;
  return window.runtime.EventsOn(`update:${name}`, (data) => handler((data ?? {}) as UpdateEventPayload));
}
