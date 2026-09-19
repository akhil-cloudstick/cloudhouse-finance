"use client";

import { useState } from "react";
import { useModal } from "@/product/components/Modal";
import { useToast } from "@/product/components/Toast";
import { useAuth } from "@/product/providers/auth-context";
import { Icon } from "@/product/components/Icon";
import { SearchableSelect } from "@/product/components/ui/SearchableSelect";
import { Select } from "@/product/components/ui/Select";
import { DatePicker } from "@/product/components/ui/DatePicker";
import { searchCustomersPage, type CustomerView } from "@/product/pages/customers/services/customerService";
import { createReminder, type ReminderView } from "@/product/pages/reminders/services/reminderService";

const TYPE_OPTIONS = [
  { value: "Follow-Up", label: "Customer Follow-Up" },
  { value: "Promise-to-Pay", label: "Promise-to-Pay Date" },
  { value: "Custom", label: "Custom Reminder" },
];

/* "Add Reminder" modal — logs a Customer Follow-Up / Promise-to-Pay /
 * Custom reminder against a customer (optionally a specific loan), backing
 * the Reminder Calendar's manual event types (see backend/internal/
 * reminder). `initialDate` prefills the due date when opened from a
 * calendar day cell. */
export function AddReminderModalContent({ initialDate, onSaved }: { initialDate?: string; onSaved?: (r: ReminderView) => void }) {
  const { closeModal } = useModal();
  const toast = useToast();
  const { employee } = useAuth();

  const [customerId, setCustomerId] = useState("");
  const [customerLabel, setCustomerLabel] = useState("");
  const [loanId, setLoanId] = useState("");
  const [type, setType] = useState<"Follow-Up" | "Promise-to-Pay" | "Custom">("Follow-Up");
  const [dueDate, setDueDate] = useState(initialDate || new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!customerId) { setErr("Please select a customer."); return; }
    if (!dueDate) { setErr("Please choose a due date."); return; }
    if (!employee) { setErr("You must be signed in to log a reminder."); return; }

    setSaving(true);
    setErr("");
    try {
      const rec = await createReminder({
        customerId: Number(customerId),
        loanId: loanId ? Number(loanId) : null,
        type,
        dueDate,
        note: note.trim(),
        employeeId: employee.id,
      });
      onSaved?.(rec);
      closeModal();
      toast(`${type} reminder logged for ${customerLabel || "customer"} — ${dueDate}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to log reminder.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="hd"><h3>Add Reminder</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd">
        <div className="frow">
          <div>
            <label className="f">Customer *</label>
            <SearchableSelect<CustomerView>
              value={customerLabel}
              placeholder="Search by name, code, or phone…"
              fetchFn={searchCustomersPage}
              getLabel={(c) => `${c.name} — ${c.code}`}
              getId={(c) => String(c.id)}
              onChange={(id, c) => { setCustomerId(id); setCustomerLabel(`${c.name} — ${c.code}`); }}
            />
          </div>
        </div>
        <div className="frow c2">
          <div>
            <label className="f">Type *</label>
            <Select
              options={TYPE_OPTIONS}
              value={type}
              onChange={(v) => setType(v as typeof type)}
            />
          </div>
          <div>
            <label className="f">Due Date *</label>
            <DatePicker value={dueDate} onChange={setDueDate} />
          </div>
        </div>
        <div className="frow">
          <div>
            <label className="f">Loan Number (optional)</label>
            <input className="inp" placeholder="Numeric loan id, if this reminder is about a specific loan" value={loanId} onChange={(e) => setLoanId(e.target.value.replace(/\D/g, ""))} />
          </div>
        </div>
        <div className="frow">
          <div><label className="f">Note</label><input className="inp" placeholder="e.g. Call about overdue interest" value={note} onChange={(e) => setNote(e.target.value)} /></div>
        </div>
        <p style={{ color: "var(--red)", fontSize: 12.5, minHeight: 16, marginTop: 8 }}>{err}</p>
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" onClick={save} disabled={saving}><Icon name="check" /> {saving ? "Saving…" : "Add Reminder"}</button>
      </div>
    </>
  );
}
