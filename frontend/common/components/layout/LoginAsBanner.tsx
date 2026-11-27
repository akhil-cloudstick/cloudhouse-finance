"use client";

import { useAuth } from "@/common/providers/AuthProvider";

/* A strip under the top bar while the superadmin is signed in with "Login as" (debugging a business's account).
 * It is there so nobody forgets that everything done in this tab is done as that employee. Nothing is drawn for an
 * ordinary sign-in. */
export function LoginAsBanner() {
	const { impersonatedBy, employee, logout } = useAuth();
	if (!impersonatedBy) return null;

	const box: React.CSSProperties = {
		display: "flex",
		alignItems: "center",
		gap: 12,
		flexWrap: "wrap",
		padding: "8px 16px",
		fontSize: 13,
		background: "var(--warn-bg, #fff4d6)",
		color: "var(--warn-fg, #5c4300)",
		borderBottom: "1px solid var(--warn-border, #e8cf8a)",
	};
	const btn: React.CSSProperties = { marginLeft: "auto", padding: "4px 12px", borderRadius: 6, border: "1px solid currentColor", background: "transparent", color: "inherit", cursor: "pointer" };

	return (
		<div style={box} role="status">
			<span>
				Superadmin session — you are signed in as <b>{employee?.name ?? "this employee"}</b>
				{employee?.role ? ` (${employee.role})` : ""}. Anything you change here is saved as them.
			</span>
			<button type="button" style={btn} onClick={() => logout()}>
				End session
			</button>
		</div>
	);
}
