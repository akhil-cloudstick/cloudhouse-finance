"use client";

import { useEffect, useState } from "react";
import { listLoginAsStaff, startLoginAs, SuperAdminApiError } from "@/modules/superadmin/services/superadminService";
import { tenantLoginLink } from "@/modules/superadmin/services/tenantLink";
import { type Business, type LoginAsStaff } from "@/modules/superadmin/types/superadmin-types";

type LoginAsModalProps = { business: Business; onClose: () => void; onDone: () => void };

/* "Login as" for debugging: pick the Administrator or any staff member and the business's own site opens in a new
 * tab already signed in as them — no password needed. The employee is not signed out and nothing in the business
 * changes by opening it; each use is written to the superadmin audit log. */
export function LoginAsModal({ business, onClose, onDone }: LoginAsModalProps) {
	const [staff, setStaff] = useState<LoginAsStaff[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busyId, setBusyId] = useState<number | null>(null);
	const [search, setSearch] = useState("");

	useEffect(() => {
		let live = true;
		listLoginAsStaff(business.id)
			.then((rows) => live && setStaff(rows))
			.catch((err) => live && setError(err instanceof SuperAdminApiError ? err.message : "Could not load the staff list."));
		return () => {
			live = false;
		};
	}, [business.id]);

	async function open(person: LoginAsStaff) {
		setError(null);
		setBusyId(person.id);
		// Opened now, inside the click: a tab opened after the request returns is blocked as a pop-up.
		const tab = window.open("about:blank", "_blank");
		// the business's page must not be able to reach back into this console window
		if (tab) tab.opener = null;
		try {
			const { code, businessCode } = await startLoginAs(business.id, person.id);
			const url = `${tenantLoginLink(businessCode || business.code)}/login?login_as=${encodeURIComponent(code)}`;
			if (tab) tab.location.replace(url);
			else window.open(url, "_blank");
			onDone();
		} catch (err) {
			tab?.close();
			setError(err instanceof SuperAdminApiError ? err.message : "Could not start the session.");
		} finally {
			setBusyId(null);
		}
	}

	const q = search.trim().toLowerCase();
	const rows = (staff ?? []).filter(
		(s) => !q || [s.name, s.username, s.role, s.branchName].some((v) => v?.toLowerCase().includes(q)),
	);

	return (
		<div className="sa-modal-backdrop" onClick={onClose}>
			<div className="sa-modal sa-loginas" onClick={(e) => e.stopPropagation()}>
				<div className="sa-modal-head">
					<h2>Login as — {business.name}</h2>
				</div>
				<div className="sa-modal-body">
					<p className="sa-hint">
						Opens the business in a new tab signed in as the person you pick, for debugging. They stay signed in and
						nothing changes until you change something — anything you do there is saved as them.
					</p>
					{staff && staff.length > 6 && (
						<div className="sa-field sa-loginas-search">
							<input placeholder="Search by name, username, role or branch" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
						</div>
					)}
					{error && <p className="sa-error">{error}</p>}
					{!staff && !error && <p className="sa-empty">Loading…</p>}
					{staff && rows.length === 0 && <p className="sa-empty">No staff found.</p>}
					{rows.length > 0 && (
						<ul className="sa-loginas-list">
							{rows.map((s) => {
								const blocked = !s.isActive ? "Role is inactive" : !s.canLogin ? "No login set up" : "";
								const meta = [s.username, s.role, s.branchName].filter(Boolean).join(" · ");
								return (
									<li key={s.id} className="sa-loginas-row">
										<div className="sa-loginas-who">
											<div className="sa-loginas-name" title={s.name}>
												{s.name}
												{s.isSystem && <span className="sa-chip active">admin</span>}
												{blocked && <span className="sa-chip suspended">{blocked}</span>}
											</div>
											<div className="sa-loginas-meta" title={meta}>{meta || "—"}</div>
										</div>
										<button
											type="button"
											className="sa-btn primary"
											disabled={busyId !== null || !s.isActive}
											title={blocked || `Open ${business.name} as ${s.name}`}
											onClick={() => open(s)}
										>
											{busyId === s.id ? "Opening…" : "Login as"}
										</button>
									</li>
								);
							})}
						</ul>
					)}
				</div>
				<div className="sa-modal-foot">
					<span className="sa-foot-spacer" />
					<button type="button" className="sa-btn" onClick={onClose}>
						Close
					</button>
				</div>
			</div>
		</div>
	);
}
