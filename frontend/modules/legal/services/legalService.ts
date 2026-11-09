/* The "App Provider" block on every store-listing page — GET /public/provider,
 * which the backend answers from the business whose code is "default".
 *
 * A bare apiRawFetch rather than apiFetch, like fetchPublicBranding: these
 * pages are read by app-store reviewers with no session, so nothing here may
 * attach a staff token or bounce to /login.
 *
 * A failed lookup returns null and the page says so. It must NOT fall back to
 * some other company's name: a policy page naming the wrong provider is worse
 * than one that says it could not load.
 *
 * apiRawFetch runs the response through the contract adapter, so keys arrive
 * already camelCased (addressLine, supportEmail, ...). */
import { apiRawFetch, resolveAssetUrl } from "@/common/services/httpClient";
import type { Provider } from "@/modules/legal/types/legal-types";

export async function fetchProvider(): Promise<Provider | null> {
	try {
		const res = await apiRawFetch("/public/provider", { cache: "no-store" });
		if (!res.ok) return null;
		const body = (await res.json()) as { data?: Partial<Provider> };
		const d = body?.data;
		if (!d?.name) return null;
		return {
			name: d.name,
			legalName: d.legalName || d.name,
			addressLine: d.addressLine ?? "",
			contactPhone: d.contactPhone ?? "",
			supportEmail: d.supportEmail ?? "",
			website: d.website ?? "",
			logoUrl: d.logoUrl ? resolveAssetUrl(d.logoUrl) : "",
		};
	} catch {
		return null;
	}
}
