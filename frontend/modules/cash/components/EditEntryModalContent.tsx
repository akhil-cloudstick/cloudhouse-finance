"use client";

import { useEffect, useState } from "react";
import { useModal } from "@/common/components/ModalProvider";
import { getExpenseEntry, getMovementEntry } from "@/modules/cash/services/cashService";
import { type EntryInfo } from "@/modules/cash/types/cash-types";
import { AddCashModalContent } from "@/modules/cash/components/AddCashModalContent";
import { ExpenseModalContent } from "@/modules/cash/components/ExpenseModalContent";
import { SelfTransferModalContent } from "@/modules/cash/components/SelfTransferModalContent";
import { EntryTypeTabs, type EntryType } from "@/modules/cash/components/AddEntryModalContent";

// viaExpense: entryId is an expense id (the Expense Register's Edit button), not a cash movement.
type EditEntryModalContentProps = { entryId: number; onSaved?: () => void; info?: EntryInfo; viaExpense?: boolean };

/* The ledger's Edit button for a cash-in, a debit or a self transfer: loads
 * the entry and opens the same form it was recorded with — Credit, Debit or
 * Self Transfer — filled in. Saving replaces the whole entry (every payment
 * line, or both legs of a transfer). */
export function EditEntryModalContent({ entryId, onSaved, info: given, viaExpense }: EditEntryModalContentProps) {
	const { closeModal } = useModal();
	const [info, setInfo] = useState<EntryInfo | null>(given ?? null);
	const [err, setErr] = useState("");

	useEffect(() => {
		if (given) return;
		let cancelled = false;
		(viaExpense ? getExpenseEntry(entryId) : getMovementEntry(entryId))
			.then((i) => { if (!cancelled) setInfo(i); })
			.catch(() => { if (!cancelled) setErr("Could not load this entry."); });
		return () => { cancelled = true; };
	}, [entryId, given, viaExpense]);

	if (!info) {
		return (
			<>
				<div className="hd"><h3>Edit Entry</h3><button className="x" onClick={closeModal}>×</button></div>
				<div className="bd"><p style={{ color: err ? "var(--red)" : "var(--muted)", fontSize: 13 }}>{err || "Loading…"}</p></div>
			</>
		);
	}
	return <EditEntryForm info={info} onSaved={onSaved} />;
}

const KIND_TO_TYPE: Partial<Record<EntryInfo["kind"], EntryType>> = { debit: "debit", cash_in: "credit", gold_sale: "credit", self_transfer: "self" };

/* The loaded entry's form, with the Debit / Credit / Self Transfer switch on top
 * so the entry's type can be changed: the form shown is the one the entry is saved as. A
 * still-pending expense keeps its own form — it cannot change type. */
function EditEntryForm({ info, onSaved }: { info: EntryInfo; onSaved?: () => void }) {
	const [type, setType] = useState<EntryType>(KIND_TO_TYPE[info.kind] ?? "credit");
	// a pending expense is not yet booked, so it cannot change type
	const canSwitch = !(info.viaExpense && info.status === "Pending");
	const tabs = canSwitch ? <EntryTypeTabs type={type} onChange={setType} /> : undefined;

	if (!canSwitch) {
		if (info.kind === "debit") return <ExpenseModalContent edit={info} onSaved={onSaved} />;
		return <AddCashModalContent edit={info} onSaved={onSaved} />;
	}
	// key per type so each tab starts from the entry's values.
	if (type === "debit") return <ExpenseModalContent key="debit" edit={info} onSaved={onSaved} tabs={tabs} />;
	if (type === "self") return <SelfTransferModalContent key="self" edit={info} onSaved={onSaved} tabs={tabs} />;
	return <AddCashModalContent key="credit" edit={info} onSaved={onSaved} tabs={tabs} />;
}
