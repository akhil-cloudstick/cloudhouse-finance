import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AsyncSelect, ChipToggle, DateField, Field, Input, PrimaryButton, Sheet, toast } from "@/common/components/ui";
import { listLoansPage } from "@/modules/loans/services/loanService";
import { listCustomers } from "@/modules/customers/services/customerService";
import { createReminder } from "@/modules/reminders/services/reminderService";
import { useAuth } from "@/common/providers/AuthProvider";
import { todayISO } from "@/common/utils/format";
import type { Loan } from "@/modules/loans/types/loan-types";
import type { Customer } from "@/modules/customers/types/customer-types";
import { userMessage } from "@/common/services/apiErrors";

// ---------------------------------------------------------------------------
// Add Reminder (prototype #reminder-create-modal)
// ---------------------------------------------------------------------------
type RType = "Follow-Up" | "Promise-to-Pay" | "Custom";
type ReminderCreateSheetProps = { visible: boolean; onClose: () => void; defaultDate?: string };

export function ReminderCreateSheet({ visible, onClose, defaultDate }: ReminderCreateSheetProps) {
  const qc = useQueryClient();
  const { employee } = useAuth();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [loan, setLoan] = useState<Loan | null>(null);
  const [type, setType] = useState<RType>("Follow-Up");
  const [due, setDue] = useState(defaultDate ?? todayISO());
  const [note, setNote] = useState("");

  useEffect(() => {
    if (visible) {
      setCustomer(null);
      setLoan(null);
      setType("Follow-Up");
      setDue(defaultDate ?? todayISO());
      setNote("");
    }
  }, [visible, defaultDate]);

  const create = useMutation({
    mutationFn: () => {
      if (!customer) throw new Error("Pick a customer.");
      if (!employee) throw new Error("Not signed in.");
      return createReminder({ customerId: customer.id, loanId: loan?.id ?? null, type, dueDate: due, note: note.trim() || undefined, employeeId: employee.id });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["reminders"] });
      toast.success("Reminder added");
      onClose();
    },
    onError: (e: Error) => toast.error("Couldn't add reminder", userMessage(e, "Please try again.")),
  });

  return (
    <Sheet visible={visible} onClose={onClose} title="Add Reminder" maxHeightPct={85}>
      <AsyncSelect<Customer>
        label="Customer"
        placeholder="Search customer"
        queryKey={["customers", "picker"]}
        fetcher={(q) => listCustomers(q || undefined)}
        selectedLabel={customer ? `${customer.name} · ${customer.code ?? ""}` : undefined}
        onClear={() => {
          setCustomer(null);
          setLoan(null);
        }}
        onSelect={(c) => {
          setCustomer(c);
          setLoan(null);
        }}
        keyOf={(c) => c.id}
        renderItem={(c) => ({ title: c.name, sub: [c.code, c.phone].filter(Boolean).join(" · ") })}
      />
      <Field label="Type">
        <ChipToggle options={["Follow-Up", "Promise-to-Pay", "Custom"] as const} value={type} onChange={setType} wrap />
      </Field>
      <DateField label="Due date" value={due} onChange={setDue} />
      {customer ? (
        <AsyncSelect<Loan>
          label="Loan number (optional)"
          placeholder="e.g. LN-2481"
          queryKey={["loans", "picker", customer.id]}
          fetcher={async (q) => (await listLoansPage({ customerId: customer.id, q: q || undefined, limit: 20, offset: 0 })).items ?? []}
          selectedLabel={loan?.loanNumber}
          onClear={() => setLoan(null)}
          onSelect={setLoan}
          keyOf={(l) => l.id}
          renderItem={(l) => ({ title: l.loanNumber, sub: l.status })}
        />
      ) : null}
      <Field label="Note">
        <Input placeholder="Add a note" value={note} onChangeText={setNote} />
      </Field>
      <PrimaryButton label="Add Reminder" onPress={() => create.mutate()} loading={create.isPending} />
    </Sheet>
  );
}
