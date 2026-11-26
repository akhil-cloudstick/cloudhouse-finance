"use client";

import { useState } from "react";
import { AddCashModalContent } from "@/modules/cash/components/AddCashModalContent";
import { ExpenseModalContent } from "@/modules/cash/components/ExpenseModalContent";
import { SelfTransferModalContent } from "@/modules/cash/components/SelfTransferModalContent";

export type EntryType = "credit" | "debit" | "self";

export const ENTRY_TABS: { type: EntryType; label: string }[] = [
	{ type: "debit", label: "Debit (Expense)" },
	{ type: "credit", label: "Credit (Cash In)" },
	{ type: "self", label: "Self Transfer" },
];

export function EntryTypeTabs({ type, onChange }: { type: EntryType; onChange: (t: EntryType) => void }) {
	return (
		<div className="frow" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 0, border: "1.5px solid var(--line)", borderRadius: 10, overflow: "hidden", padding: 0 }}>
			{ENTRY_TABS.map((t, i) => (
				<button
					key={t.type}
					type="button"
					onClick={() => onChange(t.type)}
					style={{
						border: 0, borderLeft: i ? "1.5px solid var(--line)" : 0, padding: "10px 6px", cursor: "pointer",
						fontWeight: type === t.type ? 700 : 600, fontSize: 12.5,
						background: type === t.type ? "var(--brand-pale, #eeeffe)" : "#fff",
						color: type === t.type ? "var(--brand-deep, #423591)" : "var(--muted)",
					}}
				>{t.label}</button>
			))}
		</div>
	);
}

type AddEntryModalContentProps = { onSaved?: () => void; defaultBranchId?: number };

/* The Ledger's single "Add Entry" modal. The Credit / Debit / Self Transfer
 * switch lives at the top of the modal; each tab is the existing Add Cash /
 * Record Expense form, or the Self Transfer form, so every one of them keeps
 * its own fields, categories and "search or add" pickers unchanged. */
export function AddEntryModalContent({ onSaved, defaultBranchId }: AddEntryModalContentProps) {
	const [type, setType] = useState<EntryType>("debit");

	const tabs = <EntryTypeTabs type={type} onChange={setType} />;

	// key per type so each tab starts from a clean form.
	if (type === "debit") return <ExpenseModalContent key="debit" onSaved={onSaved} tabs={tabs} />;
	if (type === "self") return <SelfTransferModalContent key="self" onSaved={onSaved} defaultBranchId={defaultBranchId} tabs={tabs} />;
	return <AddCashModalContent key="credit" onSaved={onSaved} defaultBranchId={defaultBranchId} tabs={tabs} />;
}
