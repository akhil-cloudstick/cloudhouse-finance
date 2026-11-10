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

/* Opens WebView2's DevTools panel immediately. Call ONLY after the backend
 * has already confirmed the PIN (see PinModal.tsx) — this makes no check of
 * its own. There is no persisted "unlocked" state: every call here is a
 * fresh PIN check on the caller's side, by design — closing DevTools and
 * wanting it again always means going through PinModal again. */
export function openDevTools(): Promise<BridgeResult> {
  return call((n) => n.OpenDevTools());
}

export function onUpdateEvent(
  name: UpdateEventName,
  handler: (payload: UpdateEventPayload) => void,
): () => void {
  if (!isDesktop() || !window.runtime) return noop;
  return window.runtime.EventsOn(`update:${name}`, (data) => handler((data ?? {}) as UpdateEventPayload));
}

// Content-only release — same shape as the full update above, "content:" prefixed, plus "applied".
export type ContentUpdateEventName =
  | "checking"
  | "available"
  | "not-available"
  | "progress"
  | "downloaded"
  | "applied"
  | "error";

export async function activeContentVersion(): Promise<string | null> {
  const native = app();
  if (!native) return null;
  try {
    const v = await native.ActiveContentVersion();
    return v || null;
  } catch {
    return null;
  }
}

export function checkForContentUpdate(): Promise<BridgeResult> {
  return call((n) => n.CheckContentUpdate());
}

export function downloadContentUpdate(): Promise<BridgeResult> {
  return call((n) => n.DownloadContentUpdate());
}

export function applyContentUpdate(): Promise<BridgeResult> {
  return call((n) => n.ApplyContentUpdate());
}

export function onContentUpdateEvent(
  name: ContentUpdateEventName,
  handler: (payload: UpdateEventPayload) => void,
): () => void {
  if (!isDesktop() || !window.runtime) return noop;
  return window.runtime.EventsOn(`content:${name}`, (data) => handler((data ?? {}) as UpdateEventPayload));
}

/* Offline store. One SQLite database on this PC, kept by the Go side (every save is one transaction, protected
 * secrets). In a browser there is no store, so offline mode is off and every call reports that. */
export const offlineStore = {
  available: (): boolean => isDesktop(),
  open: (business: string, device: string) => app()!.StoreOpen(business, device),
  appendOutbox: (line: string) => app()!.StoreAppendOutbox(line),
  /* What may be sent now, oldest first. Entries in review, and later ones on the same record, are left out. */
  readOutbox: () => app()!.StoreReadOutbox(),
  /* Everything this PC still holds for the server, sendable or not. */
  readAllOutbox: () => app()!.StoreReadAllOutbox(),
  /* The entry and the changed local-copy files, kept together in one transaction. */
  saveEntry: (line: string, files: Record<string, string>) => app()!.StoreSaveEntry(line, files),
  /* Changes (empty line: removes) an entry that has not been sent yet, together with the files that depend on it. */
  changeEntry: (id: string, line: string, files: Record<string, string>) => app()!.StoreChangeEntry(id, line, files),
  counts: () => app()!.StoreOutboxCounts(),
  markReview: (id: string, message: string) => app()!.StoreMarkReview(id, message),
  readReview: () => app()!.StoreReadReview(),
  retryReview: (id: string) => app()!.StoreRetryReview(id),
  deleteOutboxEntry: (id: string) => app()!.StoreDeleteOutboxEntry(id),
  readFile: (name: string) => app()!.StoreReadFile(name),
  writeFile: (name: string, content: string) => app()!.StoreWriteFile(name, content),
  log: (level: string, message: string) => app()?.StoreLog(level, message).catch(noop),
  root: () => app()!.StoreRoot(),
  rootChosen: () => app()!.StoreRootChosen(),
  /* Opens the folder picker and moves the offline data there; resolves to the new folder, or "" if closed. */
  chooseFolder: () => app()!.StoreChooseFolder(),
  useDefaultFolder: () => app()!.StoreUseDefaultFolder(),
  /* The mirror: the server's business tables, copied row for row. A batch of rows, deletions and cursors is one transaction. */
  mirrorApply: (batch: string) => app()!.StoreMirrorApply(batch),
  /* The local read server: answers a GET from this PC's copy of the business when the server cannot be reached. */
  localApiBind: (sessionJson: string) => app()!.LocalApiBind(sessionJson),
  localApiGet: (path: string, query: string, headers: Record<string, string>) => app()!.LocalApiGet(path, query, headers),
  /* The same read, answered as it will look once the changes still waiting in the outbox have been sent (the backend's own
   * handlers run them inside a transaction that is rolled back). `skipped` counts waiting changes the copy could not run. */
  localApiGetPending: (path: string, query: string, headers: Record<string, string>, pendingJson: string) =>
    app()!.LocalApiGetPending(path, query, headers, pendingJson),
  mirrorBindTenant: (tenant: number) => app()!.StoreMirrorBindTenant(tenant),
  mirrorWriteTemp: (entryId: string, batch: string) => app()!.StoreMirrorWriteTemp(entryId, batch),
  mirrorDropTemp: (entryId: string) => app()!.StoreMirrorDropTemp(entryId),
  mirrorState: (key: string) => app()!.StoreMirrorState(key),
  mirrorIds: (table: string) => app()!.StoreMirrorIDs(table),
  mirrorCounts: () => app()!.StoreMirrorCounts(),
};

/* The LAN agent (desktop/lan): finds the other PCs running the app on the same network and tests the connection.
 * `available` is false in a browser and in an older exe that was built before the agent existed. */
export type LanStatus = LanStatusInfo;
export type LanPeer = LanPeerInfo;
export type LanLogEntry = LanLogEntryInfo;
export type LanStep = LanStepInfo;
export type LanProbe = LanProbeInfo;
export type LanMainResult = LanMainResultInfo;
export type LanDataMode = LanDataModeInfo;

export const lan = {
  available: (): boolean => isDesktop() && typeof app()?.LanStatus === "function",
  status: () => app()!.LanStatus!(),
  peers: async (): Promise<LanPeer[]> => (await app()!.LanPeers!()) ?? [],
  log: async (): Promise<LanLogEntry[]> => (await app()!.LanLog!()) ?? [],
  clearLog: () => app()!.LanClearLog!(),
  selfTest: async (peer: string): Promise<LanStep[]> => (await app()!.LanSelfTest!(peer)) ?? [],
  testPeer: (target: string) => app()!.LanTestPeer!(target),
  addPeer: (target: string) => app()!.LanAddPeer!(target),
  allowAccess: () => app()!.LanAllowAccess!(),
  /* The main PC: chosen by an admin on any PC; the choice spreads to every PC on the network. */
  setMain: (id: string) => app()!.LanSetMain!(id),
  clearMain: () => app()!.LanClearMain!(),
  /* The business key the server gives every signed-in PC of the business (see common/offline/lanKey.ts). */
  setKey: (key: string) => app()!.LanSetKey!(key),
  /* Where this PC's data is (its own store, or the main PC's) and whether the store must be opened again. */
  dataMode: () => app()!.LanDataMode!(),
  /* The main PC choice or the key changed: the store may need to be opened again. */
  onMode: (handler: () => void): (() => void) => {
    if (!isDesktop() || !window.runtime) return noop;
    return window.runtime.EventsOn("lan:mode", () => handler());
  },
  /* On the main PC: a counter put something in the outbox. */
  onEntries: (handler: () => void): (() => void) => {
    if (!isDesktop() || !window.runtime) return noop;
    return window.runtime.EventsOn("lan:entries", () => handler());
  },
  onLog: (handler: (entry: LanLogEntry) => void): (() => void) => {
    if (!isDesktop() || !window.runtime) return noop;
    return window.runtime.EventsOn("lan:log", (d) => handler(d as LanLogEntry));
  },
  onPeers: (handler: (peers: LanPeer[]) => void): (() => void) => {
    if (!isDesktop() || !window.runtime) return noop;
    return window.runtime.EventsOn("lan:peers", (d) => handler((d as LanPeer[] | null) ?? []));
  },
};

/* Documents made on this PC from the bundled templates (desktop/documents.go) when the server cannot be reached. */
export const offlineDocs = {
  available: () => !!app()?.RenderOfflineDocument,
  render: (kind: string, lang: string, inputJson: string) => app()!.RenderOfflineDocument(kind, lang, inputJson),
};
