import { activeBusinessSlug, readToken } from "@/common/services/tenantSession";

/* The folder name for this business on this PC. A plain install has no business in its address, so it uses
 * "default" instead of switching offline mode off. */
export function offlineBusiness(): string {
	return activeBusinessSlug() ?? "default";
}

/* The signed-in employee, read from the session token. The token is only decoded here, never checked: the
 * server is the one that trusts or refuses it. */
export function employeeId(): number | null {
	const part = readToken()?.split(".")[1];
	if (!part) return null;
	try {
		const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
		const id = (JSON.parse(json) as { employeeId?: number }).employeeId;
		return typeof id === "number" && id > 0 ? id : null;
	} catch {
		return null;
	}
}

/* What the login token says about who is signed in (decoded, not checked: the PC has no way to verify it). The local read
 * server uses it to know whose permissions to apply. */
export function sessionClaims(): { tenantId: number; employeeId: number; roleId: number; role: string; branchId: number } | null {
	const part = readToken()?.split(".")[1];
	if (!part) return null;
	try {
		const c = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/"))) as Record<string, unknown>;
		const n = (v: unknown) => (typeof v === "number" && v > 0 ? v : 0);
		const out = { tenantId: n(c.tenantId), employeeId: n(c.employeeId), roleId: n(c.roleId), role: typeof c.role === "string" ? c.role : "", branchId: n(c.branchId) };
		return out.tenantId && out.employeeId && out.roleId ? out : null;
	} catch {
		return null;
	}
}
