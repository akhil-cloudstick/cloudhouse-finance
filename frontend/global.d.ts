// LAN agent (desktop/lan): finding other PCs on the network and testing the connection.
interface LanStatusInfo {
  id: string;
  name: string;
  version: string;
  instance: string;
  httpPort: number;
  discoveryPort: number;
  tcpListening: boolean;
  tcpError: string;
  udpListening: boolean;
  udpError: string;
  beaconsSent: number;
  beaconsReceived: number;
  interfaces: { name: string; ip: string; mask: string; broadcast: string; linkLocal: boolean }[] | null;
  noAddress: string[] | null;
  peers: number;
  logPath: string;
  extraTargets: string[] | null;
  lastSendErrors: string[] | null;
  epoch: number;
  mainId: string;
  mainName: string;
  isMain: boolean;
  mainOnline: boolean;
  hasKey: boolean;
  shared: boolean;
}
interface LanModeInfo {
  shared: boolean;
  mainId: string;
  mainName: string;
  mainOnline: boolean;
  hasKey: boolean;
  reason: string;
}
interface LanDataModeInfo {
  shared: boolean; // the data this PC is using right now is on the main PC
  mainId: string;
  needRestart: boolean; // the main PC choice changed since the store was opened
  live: LanModeInfo;
}
interface LanMainResultInfo {
  ok: boolean;
  message: string;
  epoch: number;
  mainId: string;
  mainName: string;
}
interface LanPeerInfo {
  id: string;
  name: string;
  ip: string;
  port: number;
  ips: string[] | null;
  version: string;
  source: "beacon" | "manual";
  reachable: "unknown" | "yes" | "no";
  latencyMs: number;
  detail: string;
  ageSec: number;
  isMain: boolean;
  verified: boolean;
}
interface LanLogEntryInfo {
  time: string;
  level: "info" | "ok" | "warn" | "error";
  component: string;
  message: string;
}
interface LanStepInfo {
  id: string;
  title: string;
  status: "pass" | "warn" | "fail" | "skip";
  detail: string;
  fix: string;
}
interface LanProbeInfo {
  ip: string;
  port: number;
  status: "reachable" | "refused" | "timeout" | "unreachable" | "badreply" | "error";
  latencyMs: number;
  message: string;
  peerId: string;
  peerName: string;
  peerVersion: string;
  via?: string;
}

interface DesktopApp {
  LanStatus?(): Promise<LanStatusInfo>;
  LanPeers?(): Promise<LanPeerInfo[] | null>;
  LanLog?(): Promise<LanLogEntryInfo[] | null>;
  LanClearLog?(): Promise<void>;
  LanSelfTest?(peer: string): Promise<LanStepInfo[] | null>;
  LanTestPeer?(target: string): Promise<LanProbeInfo>;
  LanAddPeer?(target: string): Promise<LanProbeInfo>;
  LanAllowAccess?(): Promise<{ ok: boolean; message: string }>;
  LanSetKey?(key: string): Promise<void>;
  LanDataMode?(): Promise<LanDataModeInfo>;
  LanSetMain?(id: string): Promise<LanMainResultInfo>;
  LanClearMain?(): Promise<LanMainResultInfo>;
  Version(): Promise<string>;
  Frameless(): Promise<boolean>;
  CheckUpdate(): Promise<void>;
  DownloadUpdate(): Promise<void>;
  InstallUpdate(): Promise<void>;
  OpenDevTools(): Promise<void>;
  // Content-only release; "" = still on the embedded (built-in) content.
  ActiveContentVersion(): Promise<string>;
  CheckContentUpdate(): Promise<void>;
  DownloadContentUpdate(): Promise<void>;
  ApplyContentUpdate(): Promise<void>;
  // Offline store: one SQLite database on this PC. See desktop/localstore.
  StoreOpen(business: string, device: string): Promise<void>;
  StoreAppendOutbox(line: string): Promise<void>;
  StoreReadOutbox(): Promise<string[]>;
  StoreDeleteOutboxEntry(id: string): Promise<void>;
  StoreSaveEntry(line: string, files: Record<string, string>): Promise<void>;
  StoreChangeEntry(id: string, line: string, files: Record<string, string>): Promise<void>;
  StoreReadAllOutbox(): Promise<string[]>;
  StoreOutboxCounts(): Promise<Record<string, number>>;
  StoreMarkReview(id: string, message: string): Promise<void>;
  StoreReadReview(): Promise<string[]>;
  StoreRetryReview(id: string): Promise<void>;
  StoreReadFile(name: string): Promise<string>;
  StoreWriteFile(name: string, content: string): Promise<void>;
  StoreLog(level: string, message: string): Promise<void>;
  StoreRoot(): Promise<string>;
  StoreRootChosen(): Promise<boolean>;
  StoreChooseFolder(): Promise<string>;
  StoreUseDefaultFolder(): Promise<void>;
  StoreMirrorApply(batch: string): Promise<void>;
  StoreMirrorBindTenant(tenant: number): Promise<void>;
  LocalApiBind(sessionJson: string): Promise<void>;
  LocalApiGet(path: string, query: string, headers: Record<string, string>): Promise<{ status: number; body: string }>;
  LocalApiGetPending(path: string, query: string, headers: Record<string, string>, pendingJson: string): Promise<{ status: number; body: string; skipped: number }>;
  StoreMirrorWriteTemp(entryId: string, batch: string): Promise<void>;
  StoreMirrorDropTemp(entryId: string): Promise<void>;
  StoreMirrorState(key: string): Promise<string>;
  StoreMirrorIDs(table: string): Promise<number[]>;
  StoreMirrorCounts(): Promise<Record<string, number>>;
  RenderOfflineDocument(kind: string, lang: string, inputJson: string): Promise<string>;
}

interface DesktopRuntime {
  EventsOn(name: string, handler: (data?: unknown) => void): () => void;
  WindowMinimise(): void;
  WindowToggleMaximise(): void;
  WindowIsMaximised(): Promise<boolean>;
  Quit(): void;
}

interface Window {
  go?: { main?: { App?: DesktopApp } };
  runtime?: DesktopRuntime;
}

declare namespace NodeJS {
  interface ProcessEnv {
    BACKEND_ORIGIN?: string;
    DEV_ORIGINS?: string;
    DESKTOP_BUILD?: string;
    NEXT_BUILD_CPUS?: string;
    NEXT_PUBLIC_API_BASE?: string;
    NEXT_PUBLIC_TENANT_APP_ORIGIN?: string;
    NEXT_PUBLIC_ENABLE_PLAN_UPGRADE?: string;
    NEXT_PUBLIC_ENABLE_UPDATE_NOTICE?: string;
    NEXT_PUBLIC_UPDATE_NOTES?: string;
    NEXT_PUBLIC_BILLING_PLANS?: string;
  }
}
