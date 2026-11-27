"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useLayoutEffect } from "react";
import { startOffline, stopOffline } from "@/common/offline";
import { offlineLogin, rememberLogin } from "@/common/offline/loginCache";
import { ApiError, quietly } from "@/common/services/httpClient";
import { offlineReady } from "@/common/offline/state";
import { isDesktop, offlineStore } from "@/common/services/desktopBridge";
import { isReachable } from "@/common/offline/network";
import { clearAuthExpired, consumeExpiredMarker } from "@/common/offline/syncProblem";
import { login as loginRequest, loginAs as loginAsRequest } from "@/common/services/authService";
import { type AuthEmployee, type LoginResponse } from "@/common/types/auth-types";
import { fetchMyPermissions } from "@/common/services/permissionService";
import { type PermissionMap } from "@/common/types/permission-types";
import { DEFAULT_APPROVAL_WORKFLOW, fetchApprovalWorkflow } from "@/common/services/approvalWorkflowService";
import { type ApprovalWorkflowConfig } from "@/common/types/approval-workflow-types";
import {
	activeBusinessSlug,
	businessCodeForRequest,
	clearSession,
	clearSessionsForToken,
	purgeStaleSession,
	readEmployeeRaw,
	readPermissionsRaw,
	readToken,
	writePermissionsRaw,
	writeSession,
} from "@/common/services/tenantSession";
import { clearSelectedBranch, getSelectedBranchId, setSelectedBranchId } from "@/common/services/branchSelection";
import { setOwnBranchFallback } from "@/modules/branches/services/branchService";

/* The session (token, employee, and the sessionStorage mirror of the
 * permission map) is stored per business by tenantSession, not under one
 * global key. Two businesses open in two tabs would otherwise overwrite each
 * other's sign-in.
 *
 * The permission mirror still dies with the tab, is still cleared on logout,
 * and is still never an authority — see the role-permission standard's §9.3.
 * It is only keyed now. */

type JwtPayload = {
	employeeId?: number;
	role?: string;
	branchId?: number;
	// set only on a "Login as" session opened from the superadmin console
	imp?: number;
	exp?: number;
	iat?: number;
};

/* Decodes the payload segment of a JWT client-side — base64url decode +
 * JSON.parse, no signature verification (the backend is the source of
 * truth for validity; this is only used to read `exp`/role/branchId for
 * UI purposes and to know locally whether a stored token has expired). */
function decodeJwtPayload(token: string): JwtPayload | null {
	try {
		const part = token.split(".")[1];
		if (!part) return null;
		const base64 = part.replace(/-/g, "+").replace(/_/g, "/");
		const json = decodeURIComponent(
			atob(base64)
				.split("")
				.map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
				.join("")
		);
		return JSON.parse(json) as JwtPayload;
	} catch {
		return null;
	}
}

function isTokenValid(token: string | null): boolean {
	if (!token) return false;
	const payload = decodeJwtPayload(token);
	if (!payload?.exp) return false;
	return payload.exp * 1000 > Date.now();
}

type AuthContextValue = {
	token: string | null;
	employee: AuthEmployee | null;
	role: string | null;
	// branchId is the logged-in employee's own branch (from employee.branchId,
	// falling back to the JWT payload) — non-admin create forms auto-lock to
	// this. null while loading/logged out.
	branchId: number | null;
	// isSystem: the employee's role is the business's system role, which the
	// backend lets act at every approval stage.
	isSystem: boolean;
	// isCrossBranch: this role sees every branch of the business and can use
	// the branch switcher (Branch_Management.can_view_all_branches).
	isCrossBranch: boolean;
	// selectedBranchId: the branch the switcher currently narrows the view to,
	// or null for "all branches". Meaningless (and ignored server-side) for a
	// role that isn't isCrossBranch.
	selectedBranchId: number | null;
	setSelectedBranch: (branchId: number | null) => void;
	loading: boolean;
	login: (identifier: string, password: string, businessCode?: string) => Promise<AuthEmployee>;
	// Trades a one-time code from the superadmin console's "Login as" for a session. Nothing is saved for offline
	// sign-in, so the employee's own login is untouched.
	loginWithCode: (code: string) => Promise<AuthEmployee>;
	// The superadmin behind a "Login as" session; null for an ordinary sign-in.
	impersonatedBy: number | null;
	logout: () => void;
	// Permission map — see the house role-permission standard's §9. Fetched on
	// login and on every app mount (fetchPermissions below), never derived
	// from the JWT (a revoked permission must take effect on next load without
	// waiting for the token to expire).
	permissions: PermissionMap;
	permissionsLoaded: boolean;
	permissionsFailed: boolean;
	// can(module, key) is the one lookup every gate/guard/nav-filter in this
	// app uses — `=== true` so a missing module/key/loading state all deny
	// (§10). Module/key names use the underscored form the backend already
	// derives (e.g. "Loan_Management", "can_view_loan_module").
	can: (moduleKey: string, permissionKey: string) => boolean;
	refetchPermissions: () => void;
	// This business's approval-workflow configuration (which stages of each
	// approval flow are switched on) — loaded next to the permission map and
	// falling back to the catalogue defaults until/unless the fetch succeeds.
	// Read it through useApprovalWorkflow() below.
	approvalWorkflow: ApprovalWorkflowConfig;
	refreshApprovalWorkflow: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

type AuthProviderProps = { children: React.ReactNode };

export function AuthProvider({ children }: AuthProviderProps) {
	// Every piece of session state below starts from the same SSR-safe
	// default (null/true/{}/false) on both the server and the client's FIRST
	// render — never a lazy initializer reading localStorage/sessionStorage
	// directly, which used to return one thing server-side (no storage exists
	// there) and a DIFFERENT thing on the client's first render (the real
	// stored session), a guaranteed hydration mismatch that threw away and
	// rebuilt this entire subtree on every page load in dev (`next dev` still
	// server-renders this "use client" page per-request; only the production
	// static export skips that step, which is why this only ever surfaced in
	// dev).
	//
	// The restore below still runs before the browser paints anything,
	// though: `useLayoutEffect` (unlike `useEffect`) fires synchronously after
	// the DOM commit but before paint, so a valid stored session still swaps
	// in fast enough that no visible blank/"headerless" frame appears — same
	// user-facing result the old synchronous initializers were after, just
	// moved to a point in the lifecycle where hydration has already reconciled
	// against the identical (default) values the server rendered.
	const [token, setToken] = useState<string | null>(null);
	const [employee, setEmployee] = useState<AuthEmployee | null>(null);

	// The branch switcher's current selection — session-scoped by design (see
	// branchSelection.ts's header comment).
	//
	// Declared here (ahead of login/logout below, which both reset it) purely
	// so those callbacks can reference the setter without a forward reference.
	const [selectedBranchId, setSelectedBranchIdState] = useState<number | null>(null);
	const [loading, setLoading] = useState(true);

	const [permissions, setPermissions] = useState<PermissionMap>({});
	const [permissionsLoaded, setPermissionsLoaded] = useState(false);
	const [permissionsFailed, setPermissionsFailed] = useState(false);
	const [approvalWorkflow, setApprovalWorkflow] = useState<ApprovalWorkflowConfig>(DEFAULT_APPROVAL_WORKFLOW);

	// Not an authority either — every stage transition is enforced
	// server-side. On failure the catalogue defaults stay in place so trackers
	// and buttons still render something sensible.
	const loadApprovalWorkflow = useCallback(async () => {
		try {
			const data = await fetchApprovalWorkflow();
			if (data.length) setApprovalWorkflow(data);
				// Desktop answered from this PC's copy: bring the server's current configuration in behind it (see loadPermissions)
				if (isDesktop() && offlineReady()) {
					void quietly(() => fetchApprovalWorkflow())
						.then((fresh) => {
							if (fresh.length) setApprovalWorkflow(fresh);
						})
						.catch(() => undefined);
				}
		} catch {
			/* keep whatever is already loaded (defaults on first load) */
		}
	}, []);

	// Fetched on login AND on every app mount (the effect below) — a refresh
	// must not run on a potentially days-old cached grant (§9.2). Mirrors into
	// sessionStorage so a refresh rehydrates instantly; on failure sets
	// `loaded` anyway (so guards don't hang forever) plus `failed` (so a
	// retry banner can render) with an empty map (fail closed, §9.4).
	const loadPermissions = useCallback(async (emp: AuthEmployee) => {
		try {
			const data = await fetchMyPermissions(emp.id);
			setPermissions(data);
			setPermissionsFailed(false);
			writePermissionsRaw(activeBusinessSlug(), JSON.stringify(data));
				// Desktop reads this PC's own copy first, so the grants are re-read from the server in the background (never
				// from a days-old copy for long): a change made there takes effect here as soon as the server answers. No answer
				// (offline) changes nothing.
				if (isDesktop() && offlineReady()) {
					void quietly(() => fetchMyPermissions(emp.id))
						.then((fresh) => {
							setPermissions(fresh);
							writePermissionsRaw(activeBusinessSlug(), JSON.stringify(fresh));
						})
						.catch(() => undefined);
				}
		} catch {
			setPermissions({});
			setPermissionsFailed(true);
				// Desktop with no connection (the request got no answer at all): keep working on the grants kept from the last
				// sign-in instead of blanking the app. A server that answers (401/403) still fails closed, as above.
				if (isDesktop() && !isReachable()) {
					const kept = readPermissionsRaw();
					if (kept) {
						try {
							setPermissions(JSON.parse(kept) as PermissionMap);
							setPermissionsFailed(false);
						} catch {
							/* an unreadable copy keeps the fail-closed state */
						}
					}
				}
		} finally {
			setPermissionsLoaded(true);
		}
	}, []);

	// Restore session from localStorage before the browser paints, discarding
	// it if the token has already expired. `useLayoutEffect`, not `useEffect`
	// — it runs synchronously right after this render commits to the DOM but
	// before the browser draws anything, so a valid stored session swaps in
	// ahead of the first visible frame instead of after it (no blank/
	// "headerless" flash), while every render up to and including this one
	// still matched the server's SSR-safe defaults (see the state
	// declarations' own comment above for why that match matters).
	useLayoutEffect(() => {
		// Housekeeping: drop the storage keys written under the app's previous
		// name. Nothing is carried over — the rebrand renamed the session keys,
		// so those values are unreadable and their holder signs in again once.
		purgeStaleSession();

		setSelectedBranchIdState(getSelectedBranchId());

		// the last run ended with the server refusing this sign-in: this run starts at the sign-in page
		if (isDesktop() && consumeExpiredMarker()) clearSession();
		const storedToken = readToken();
		const storedEmployee = readEmployeeRaw();
		if (storedToken && isTokenValid(storedToken)) {
			setToken(storedToken);
			if (storedEmployee) {
				try {
					const emp = JSON.parse(storedEmployee) as AuthEmployee;
					setEmployee(emp);
					const cached = readPermissionsRaw();
					if (cached) {
						try {
							setPermissions(JSON.parse(cached) as PermissionMap);
							setPermissionsLoaded(true);
						} catch {
							/* fall through to a live fetch below */
						}
					}
					void loadPermissions(emp);
					void loadApprovalWorkflow();
				} catch {
					setEmployee(null);
				}
			}
		} else {
			clearSession();
		}
		setLoading(false);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	/* businessCode is optional: the per-business login link supplies it from
	 * the URL slug, the bare /login form from its business-code field, and a
	 * single-business installation not at all (the backend resolves it). It is
	 * also the slug the resulting session is stored under, so signing into a
	 * second business in another tab cannot overwrite the first. */
	const login = useCallback(
		async (identifier: string, password: string, businessCode?: string) => {
			const code = businessCode?.trim() || businessCodeForRequest();
			let res: LoginResponse;
			try {
				// Desktop and the computer reports no connection at all: go straight to the saved sign-in, no waiting on the network
				if (offlineStore.available() && typeof navigator !== "undefined" && navigator.onLine === false) throw new ApiError("", 0);
				res = await loginRequest(identifier, password, code);
				// Saved before this returns: the moment login() finishes the page moves into the app, and that would cut a
				// save still running in the background short. Bounded, so a slow disk can never hold the sign-in up.
				await Promise.race([rememberLogin(identifier, password, res), new Promise<void>((resolve) => setTimeout(resolve, 4000))]);
			} catch (e) {
				// Desktop only: when the server cannot be reached at all, someone who has signed in on this PC before may
				// sign in again. A server that answers (a wrong password, say) is never overruled.
				if (!(e instanceof ApiError) || e.status !== 0) throw e;
				const offline = await offlineLogin(identifier, password);
				if (offline.status === "ok") res = offline.response;
				else if (offline.status === "wrong") throw new ApiError("invalid username/phone or password", 401);
				else if (offline.status === "locked") throw new ApiError("Too many attempts. Wait a moment and try again.", 429);
				else if (offlineStore.available()) {
					throw new ApiError("Can't reach the server. Sign in once while online to enable offline sign-in.", 0);
				} else throw e;
			}
			writeSession(code || null, res.token, JSON.stringify(res.employee));
			clearAuthExpired(); // a fresh sign-in: the waiting changes go out under it
			// A fresh sign-in starts at "all branches" rather than reopening
			// whatever a previous session under this business chose.
			clearSelectedBranch(code || null);
			setSelectedBranchIdState(null);
			setToken(res.token);
			setEmployee(res.employee);
			setPermissionsLoaded(false);
			void loadPermissions(res.employee);
			void loadApprovalWorkflow();
			return res.employee;
		},
		[loadPermissions, loadApprovalWorkflow]
	);

	const loginWithCode = useCallback(
		async (loginCode: string) => {
			const code = businessCodeForRequest();
			const res = await loginAsRequest(loginCode);
			writeSession(code || null, res.token, JSON.stringify(res.employee));
			clearAuthExpired();
			clearSelectedBranch(code || null);
			setSelectedBranchIdState(null);
			setToken(res.token);
			setEmployee(res.employee);
			setPermissionsLoaded(false);
			void loadPermissions(res.employee);
			void loadApprovalWorkflow();
			return res.employee;
		},
		[loadPermissions, loadApprovalWorkflow]
	);

	/* Signs out of THIS business only. Another business signed in in another
	 * tab keeps its session, which is the point of keying by slug — logging out
	 * of one customer's books must not log you out of another's. */
	const logout = useCallback(() => {
		/* Resolve the slug ONCE and clear everything against that one answer.
		 *
		 * clearSession() used to be called with no slug, which made it re-resolve
		 * activeBusinessSlug() internally — and that walks path, then host, then
		 * the remembered-business pointer. So the key it removed was whatever the
		 * URL happened to say at that instant, while the login page then read the
		 * key its OWN url resolved to. When those disagreed, the token survived,
		 * the login page saw a valid session and bounced straight back to the
		 * dashboard: the "first click on Sign out does nothing" bug. */
		const slug = activeBusinessSlug();
		clearSession(slug);
		/* ...and then again by TOKEN VALUE, which is the authoritative sweep.
		 *
		 * The slug above is still resolved from the URL, and the paragraph above
		 * describes why that can be the wrong answer. When it is, the line above
		 * removes a key that was never there and the real token lives on under
		 * the bucket writeSession actually chose — so the login page reads a live
		 * session and bounces back to the dashboard, the "sign out, see login for
		 * a moment, land back on home" bug. clearSessionsForToken finds the token
		 * wherever it is; matching on the value means it cannot touch another
		 * business's session in another tab. */
		clearSessionsForToken(token);
		// A branch selection is a lens on THIS sign-in — the next person to log
		// in on this machine (or this person, on a different business) should
		// start at "all branches", not silently inherit whatever was selected.
		clearSelectedBranch(slug);
		setSelectedBranchIdState(null);
		setToken(null);
		setEmployee(null);
		setPermissions({});
		setPermissionsLoaded(false);
		setPermissionsFailed(false);
		setApprovalWorkflow(DEFAULT_APPROVAL_WORKFLOW);
		// `token` is a real dependency now, not incidental: clearSessionsForToken
		// matches on its value. Signing out with a stale closure would sweep the
		// PREVIOUS token's buckets and leave the current one behind.
	}, [token]);

	// Desktop only: once signed in, open this PC's offline store and start the sender. Does nothing in a browser.
	useEffect(() => {
		if (token && employee) void startOffline();
		else stopOffline();
	}, [token, employee]);

	const refetchPermissions = useCallback(() => {
		if (employee) void loadPermissions(employee);
	}, [employee, loadPermissions]);

	const can = useCallback(
		(moduleKey: string, permissionKey: string) => permissions?.[moduleKey]?.[permissionKey] === true,
		[permissions]
	);

	const role = useMemo(() => employee?.role ?? decodeJwtPayload(token || "")?.role ?? null, [employee, token]);

	const branchId = useMemo(() => {
		const fromEmployee = employee?.branchId;
		if (typeof fromEmployee === "number") return fromEmployee;
		const fromToken = decodeJwtPayload(token || "")?.branchId;
		return typeof fromToken === "number" ? fromToken : null;
	}, [employee, token]);

	// Branch pickers fall back to this when the role cannot list branches.
	// Until permissions load, assume it can (pages don't render before then).
	const canViewBranches = !permissionsLoaded || can("Branch_Management", "can_view_branch_module");
	useLayoutEffect(() => {
		setOwnBranchFallback(employee?.branch ?? null, canViewBranches);
	}, [employee, canViewBranches]);

	const impersonatedBy = useMemo(() => decodeJwtPayload(token || "")?.imp ?? null, [token]);

	const isSystem = employee?.isSystem === true;
	const isCrossBranch = can("Branch_Management", "can_view_all_branches");

	// effectiveSelectedBranchId is null for a role that isn't cross-branch,
	// regardless of what sessionStorage holds.
	//
	// Derived at render rather than reset in an effect: the only way a
	// signed-in session's role can change at all is a fresh login, and login
	// already clears the stored selection (see the login callback above) — so
	// there is no transition to catch here, only a value to compute. A role
	// that is not cross-branch simply never sees a selection, whatever is
	// sitting in storage from a previous session under the same slug.
	const effectiveSelectedBranchId = isCrossBranch ? selectedBranchId : null;

	const setSelectedBranch = useCallback((branchId: number | null) => {
		setSelectedBranchId(branchId);
		setSelectedBranchIdState(branchId);
	}, []);

	const value = useMemo(
		() => ({
			token,
			employee,
			role,
			branchId,
			isSystem,
			isCrossBranch,
			selectedBranchId: effectiveSelectedBranchId,
			setSelectedBranch,
			loading,
			login,
			loginWithCode,
			impersonatedBy,
			logout,
			permissions,
			permissionsLoaded,
			permissionsFailed,
			can,
			refetchPermissions,
			approvalWorkflow,
			refreshApprovalWorkflow: loadApprovalWorkflow,
		}),
		[
			token,
			employee,
			role,
			branchId,
			isSystem,
			isCrossBranch,
			effectiveSelectedBranchId,
			setSelectedBranch,
			loading,
			login,
			loginWithCode,
			impersonatedBy,
			logout,
			permissions,
			permissionsLoaded,
			permissionsFailed,
			can,
			refetchPermissions,
			approvalWorkflow,
			loadApprovalWorkflow,
		]
	);

	return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
	const ctx = useContext(AuthContext);
	if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
	return ctx;
}

/* The approval-workflow configuration plus a refresh (call after saving it
 * on the Roles & Permissions page). Pair with the lookup helpers in
 * approvalWorkflowService.ts (chainFor, stageByPending, isFinalStage, …). */
export function useApprovalWorkflow(): { config: ApprovalWorkflowConfig; refresh: () => Promise<void> } {
	const { approvalWorkflow, refreshApprovalWorkflow } = useAuth();
	return { config: approvalWorkflow, refresh: refreshApprovalWorkflow };
}

export { isTokenValid };
