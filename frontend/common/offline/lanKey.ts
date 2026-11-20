/* The business key. Every PC that signs in to a business online asks the server for that business's key and hands it to the
 * desktop app (desktop/lan). The PCs use it to sign what they announce on the local network and every request a counter
 * makes to the main PC, so only PCs of this business can take part. Offline, the key kept from an earlier sign-in is used. */

import { lan } from "@/common/services/desktopBridge";
import { apiFetchEnveloped, quietly } from "@/common/services/httpClient";
import { employeeId } from "./session";

const WAIT_MS = 4000;

/* Best effort and quick: with no connection the sign-in must not wait on it. */
export async function ensureLanKey(): Promise<void> {
	if (!lan.available()) return;
	const id = employeeId();
	if (!id) return;
	try {
		const answer = await Promise.race([
			quietly(() => apiFetchEnveloped<{ key?: string }>(`/users/${id}/sync/lan-key`)),
			new Promise<null>((resolve) => setTimeout(() => resolve(null), WAIT_MS)),
		]);
		if (answer?.key) await lan.setKey(answer.key);
	} catch {
		/* offline, or an older server without the route: the key kept from an earlier sign-in (if any) is used */
	}
}
