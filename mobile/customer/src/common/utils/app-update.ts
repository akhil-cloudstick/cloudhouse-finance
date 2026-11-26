import * as Application from 'expo-application';
import { File, Paths } from 'expo-file-system';
import * as IntentLauncher from 'expo-intent-launcher';
import { Linking, Platform } from 'react-native';

// New-version check, the same as CloudHouse ERP's (without over-the-air updates: every change ships as a new build).
// The GitHub build (.github/workflows/mobile.yml) publishes each preview APK with a latest.json next to it; the app
// compares that version with its own and offers the new build: Android downloads the APK inside the app and hands it
// to the system installer, iPhone opens TestFlight (Apple doesn't let an app install builds itself).

// --- Types ---
export type UpdateStatus = 'idle' | 'checking' | 'upToDate' | 'install' | 'downloading' | 'ready' | 'error';

export type AppUpdateState = {
  status: UpdateStatus;
  progress: number;
  currentVersion: string;
  latestVersion: string | null;
  // Where the new build is installed from (the APK link, or the TestFlight link) while status is install.
  installUrl: string | null;
  error: 'check' | 'download' | null;
  isSheetOpen: boolean;
  // Swiped away while a build waited: no more pop-ups this session; More still opens it.
  isDismissed: boolean;
};

// Written by the build workflow next to the APK; always the newest build's.
type LatestBuild = { version: string; android?: string; ios?: string };

// --- Constants ---
const RELEASES_URL = 'https://github.com/akhil-cloudstick/cloudhouse-finance-releases/releases/download';
// This app's releases: <app>-latest for the shop app, <app>-dev for the developer build (APP_VARIANT=development),
// so a shop phone never sees a developer build.
const APP_KEY = 'customer';
const APK_NAME = 'cloudhouse-customer';
const DEV_APP_ID_SUFFIX = '.dev';
// iPhone, when latest.json has no TestFlight link: opens the TestFlight app, which lists the new build with Update.
const TESTFLIGHT_APP_URL = 'itms-beta://';
const FETCH_TIMEOUT_MS = 8000;
const APK_MIME = 'application/vnd.android.package-archive';
// Android: let the package installer read the downloaded APK.
const FLAG_GRANT_READ_URI_PERMISSION = 1;

// --- Helpers ---
const isDevApp = !!Application.applicationId?.endsWith(DEV_APP_ID_SUFFIX);
const latestUrl = isDevApp ? `${RELEASES_URL}/${APP_KEY}-dev/latest-dev.json` : `${RELEASES_URL}/${APP_KEY}-latest/latest.json`;

// 1.0.10 > 1.0.9 > 1.0: compared part by part as numbers; missing parts count as 0.
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// The installed build's expo.version (app.json), the number each release raises.
function installedVersion(): string {
  return Application.nativeApplicationVersion ?? '0';
}

// The newest published build, or null when it can't be read. The query string skips any cached copy.
async function fetchLatestBuild(): Promise<LatestBuild | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${latestUrl}?t=${Date.now()}`, { signal: controller.signal });
    return res.ok ? ((await res.json()) as LatestBuild) : null;
  } finally {
    clearTimeout(timer);
  }
}

// That build, when its version is strictly higher than the installed one: never an older or equal one.
function newerBuild(latest: LatestBuild | null): { version: string; url: string } | null {
  if (!latest?.version || compareVersions(latest.version, installedVersion()) <= 0) return null;
  const url = Platform.OS === 'ios' ? latest.ios || TESTFLIGHT_APP_URL : latest.android;
  return url ? { version: latest.version, url } : null;
}

// --- State ---
let state: AppUpdateState = {
  status: 'idle',
  progress: 0,
  currentVersion: installedVersion(),
  latestVersion: null,
  installUrl: null,
  error: null,
  isSheetOpen: false,
  isDismissed: false,
};
const listeners = new Set<() => void>();
let apkFile: File | null = null;

function set(patch: Partial<AppUpdateState>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

// --- API ---
export function subscribeAppUpdate(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getAppUpdate(): AppUpdateState {
  return state;
}

// silent: the start-up / back-to-the-app check — opens the sheet only when there is a newer build, and stays quiet
// when offline. Not silent: from the menu, shows "up to date" or the error.
export async function checkForUpdate({ silent }: { silent: boolean }): Promise<void> {
  // Only native builds can install anything; nothing to check in a browser.
  if (Platform.OS === 'web') return;
  if (state.status === 'checking' || state.status === 'downloading' || state.status === 'ready') return;
  set({ status: 'checking', error: null });
  try {
    const build = newerBuild(await fetchLatestBuild());
    if (!build) {
      set({ status: 'upToDate', latestVersion: null, installUrl: null });
      return;
    }
    set({ status: 'install', latestVersion: build.version, installUrl: build.url });
    if (silent && !state.isDismissed) set({ isSheetOpen: true });
  } catch {
    set({ status: silent ? 'idle' : 'error', error: silent ? null : 'check' });
  }
}

// Android: downloads the APK inside the app with progress, then the sheet offers Install. iPhone: opens TestFlight.
export async function installNewBuild(): Promise<void> {
  const url = state.installUrl;
  if (!url || state.status === 'downloading') return;
  if (Platform.OS !== 'android') {
    Linking.openURL(url).catch(() => set({ status: 'error', error: 'check' }));
    return;
  }
  set({ status: 'downloading', progress: 0, error: null });
  try {
    const destination = new File(Paths.cache, `${APK_NAME}-${state.latestVersion ?? 'latest'}.apk`);
    if (destination.exists) destination.delete();
    const task = File.createDownloadTask(url, destination, {
      onProgress: ({ bytesWritten, totalBytes }) => {
        if (totalBytes > 0) set({ progress: bytesWritten / totalBytes });
      },
    });
    const file = await task.downloadAsync();
    if (!file) throw new Error('Download cancelled');
    apkFile = file;
    // Pops the sheet back up with Install, even if it was swiped away during the download.
    set({ status: 'ready', progress: 1, isSheetOpen: true });
  } catch {
    set({ status: 'error', error: 'download', progress: 0, isSheetOpen: true });
  }
}

// Android shows its own "Update this app?" confirmation; the app's data is kept (same id, same signing key).
export async function installApk(): Promise<void> {
  if (!apkFile) return;
  try {
    await IntentLauncher.startActivityAsync('android.intent.action.VIEW', { data: apkFile.contentUri, flags: FLAG_GRANT_READ_URI_PERMISSION, type: APK_MIME });
  } catch {
    set({ status: 'error', error: 'download', isSheetOpen: true });
  }
}

// From the app's own menu: opens the sheet and refreshes the status when nothing is in progress.
export function openUpdateSheet(): void {
  set({ isSheetOpen: true });
  if (state.status === 'idle' || state.status === 'upToDate' || state.status === 'error') {
    checkForUpdate({ silent: false });
  }
}

export function closeUpdateSheet(): void {
  set({ isSheetOpen: false, isDismissed: state.isDismissed || state.status === 'install' });
}
