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
