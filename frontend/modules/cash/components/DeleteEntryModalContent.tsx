"use client";

import { useState } from "react";
import { useModal } from "@/common/components/ModalProvider";
import { useToast } from "@/common/components/ToastProvider";
import { Icon } from "@/common/components/Icon";
import { FieldError } from "@/common/components/ui/FieldError";
import { ApiError } from "@/common/services/httpClient";
import { singleFlight } from "@/common/utils/singleFlight";
import { deleteMovementEntry } from "@/modules/cash/services/cashService";

type Props = { entryId: number; label?: string; onDeleted?: () => void };

/* Confirms and deletes a cash-in, debit, self transfer or gold sale from the ledger. */
export function DeleteEntryModalContent({ entryId, label, onDeleted }: Props) {
	const { closeModal } = useModal();
	const toast = useToast();
	const [err, setErr] = useState("");
	const [saving, setSaving] = useState(false);

	async function confirm() {
		return singleFlight("modal:delete-entry", async () => {
			setSaving(true);
			try {
				await deleteMovementEntry(entryId);
				toast("Entry deleted");
				onDeleted?.();
				closeModal();
			} catch (e) {
				setErr(e instanceof ApiError ? e.message : "Could not delete this entry — try again.");
			} finally {
				setSaving(false);
			}
		});
	}

	return (
		<>
			<div className="hd"><h3>Delete Entry</h3><button className="x" onClick={closeModal}>×</button></div>
			<div className="bd">
				<p style={{ marginBottom: 12 }}>Delete {label ? <b>{label}</b> : "this entry"}? Every payment line of it is removed from the ledger and the balances update.</p>
				<FieldError msg={err} />
			</div>
			<div className="ft">
				<button className="btn ghost" onClick={closeModal} disabled={saving}>Cancel</button>
				<button className="btn" onClick={confirm} disabled={saving}><Icon name="trash" /> {saving ? "Deleting…" : "Delete"}</button>
			</div>
		</>
	);
}
