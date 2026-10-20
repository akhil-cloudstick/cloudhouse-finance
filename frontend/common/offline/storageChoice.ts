/* The first-use question "where should this PC keep offline data?". startOffline waits here until the user has
 * answered; OfflineStoragePrompt (mounted in the app shell) shows the dialog while a question is pending. A
 * module-level state with subscribers, because the prompt may mount after the question was asked. */

let pending = false;
let waiter: Promise<void> | null = null;
let release: (() => void) | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((fn) => fn());
}

export function askStorageChoice(): Promise<void> {
  if (!waiter) {
    pending = true;
    waiter = new Promise<void>((resolve) => {
      release = resolve;
    });
    emit();
  }
  return waiter;
}

export function storageChoiceDone(): void {
  pending = false;
  waiter = null;
  release?.();
  release = null;
  emit();
}

export function isStorageChoicePending(): boolean {
  return pending;
}

export function subscribeStorageChoice(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
