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
  // Offline store: plain files on this PC. See desktop/localstore.
  StoreOpen(business: string, device: string): Promise<void>;
  StoreAppendOutbox(line: string): Promise<void>;
  StoreReadOutbox(): Promise<string[]>;
  StoreDeleteOutboxEntry(id: string): Promise<void>;
  StoreReadFile(name: string): Promise<string>;
  StoreWriteFile(name: string, content: string): Promise<void>;
  StoreLog(level: string, message: string): Promise<void>;
  StoreRoot(): Promise<string>;
  StoreRootChosen(): Promise<boolean>;
  StoreChooseFolder(): Promise<string>;
  StoreUseDefaultFolder(): Promise<void>;
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
