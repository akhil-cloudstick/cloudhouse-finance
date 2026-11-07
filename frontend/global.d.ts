interface DesktopApp {
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
