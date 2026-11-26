import type { useRouter } from "next/navigation";

type Router = ReturnType<typeof useRouter>;
type SuperAdminPage = "/" | "/login";

/* On its own subdomain (superadmin.<base domain>) the console lives at clean
 * URLs — "/" is the dashboard and "/login" the sign-in — because the backend
 * maps them onto the exported /superadmin pages (see rewriteForSuperAdminHost
 * in backend/modules/WebApp/controllers/web_static.go). There the move is a
 * full page load: Next's client router would resolve "/" and "/login" to the
 * landing and tenant-login routes instead. Anywhere else (local dev, or a
 * host without the subdomain) the exported /superadmin routes are used as before. */
function onSuperAdminHost(): boolean {
  return typeof window !== "undefined" && window.location.hostname.startsWith("superadmin.");
}

export function goToSuperAdmin(router: Router, page: SuperAdminPage, mode: "push" | "replace" = "replace"): void {
  if (onSuperAdminHost()) {
    if (mode === "push") window.location.assign(page);
    else window.location.replace(page);
    return;
  }
  const target = page === "/" ? "/superadmin" : `/superadmin${page}`;
  if (mode === "push") router.push(target);
  else router.replace(target);
}
