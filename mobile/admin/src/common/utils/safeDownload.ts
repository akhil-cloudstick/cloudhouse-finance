import * as FileSystem from "expo-file-system/legacy";

/** The app's cache folder can be missing (purged by the OS, or never created on a fresh install),
 * and downloadAsync refuses to create it. Create it first, then download. */
export async function safeDownload(
  url: string,
  target: string,
  options?: FileSystem.DownloadOptions,
): Promise<FileSystem.FileSystemDownloadResult> {
  const dir = target.slice(0, target.lastIndexOf("/") + 1);
  if (dir) {
    try {
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    } catch {
      /* already exists */
    }
  }
  return FileSystem.downloadAsync(url, target, options);
}
