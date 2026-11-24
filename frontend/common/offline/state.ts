/* Whether offline mode is running. Kept apart from index.ts so the modules index.ts depends on can read it
 * without importing index.ts back. */

let ready = false;

export function offlineReady(): boolean {
	return ready;
}

export function setOfflineReady(on: boolean): void {
	ready = on;
}

/* True on a counter: a main PC has been chosen and this PC keeps no business data of its own, it uses the main PC's. The
 * main PC does the sending to the server and the downloading for everyone, so a counter must not do either (it would
 * send the same entries again, under its own sign-in, and download everything a second time). */
let shared = false;

export function sharedData(): boolean {
	return shared;
}

export function setSharedData(on: boolean): void {
	shared = on;
}
