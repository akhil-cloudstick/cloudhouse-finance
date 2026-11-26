/* Whether the server answered the last request this PC made. The only signal is a real request: it is set to
 * reachable when any request gets an answer, and to unreachable when one gets none (status 0). The header's Wi-Fi
 * indicator reads it. No imports, so the HTTP client can use it without a cycle. */

export const NETWORK_EVENT = "app:network-state";

let reachable = true;

export function isReachable(): boolean {
	return reachable;
}

export function setReachable(next: boolean): void {
	if (next === reachable) return;
	reachable = next;
	if (typeof window !== "undefined") window.dispatchEvent(new Event(NETWORK_EVENT));
}

// The computer itself says it is off the network: show it at once instead of waiting for a request to fail.
if (typeof window !== "undefined") window.addEventListener("offline", () => setReachable(false));
