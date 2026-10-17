interface DesktopApp {
  Version(): Promise<string>;
  Frameless(): Promise<boolean>;
  CheckUpdate(): Promise<void>;
  DownloadUpdate(): Promise<void>;
  InstallUpdate(): Promise<void>;
  OpenDevTools(): Promise<void>;
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
