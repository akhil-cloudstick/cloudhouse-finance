import { useEffect, useState } from "react";
import { DateField, Field, FieldRow, Input, PrimaryButton, Sheet, toast } from "@/common/components/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FieldErr } from "@/common/components/ErrorText";
import { ApiError } from "@/common/services/httpClient";
import { todayISO } from "@/common/utils/format";
import { createDayBookEntry, updateDayBookEntry } from "@/modules/reports/services/reportsService";
import { type DayBookInput, type DayBookRow } from "@/modules/reports/types/reports-types";

// Add or edit one Day Book line: date, particulars and a debit, credit and/or interest amount.
// Opened from the Day Book sheet and from the dashboard's Quick actions. The one error line sits
// above the button.

const amountText = (v?: number) => (v ? String(v) : "");
const cleanAmount = (t: string) => t.replace(/[^0-9.]/g, "");
const num = (s: string) => (s.trim() === "" ? 0 : Number(s));

type DayBookEntrySheetProps = { visible: boolean; onClose: () => void; entry?: DayBookRow | null; onSaved?: () => void };

export function DayBookEntrySheet({ visible, onClose, entry, onSaved }: DayBookEntrySheetProps) {
  const qc = useQueryClient();
  const [date, setDate] = useState(todayISO());
  const [particulars, setParticulars] = useState("");
  const [debit, setDebit] = useState("");
  const [credit, setCredit] = useState("");
  const [interest, setInterest] = useState("");
  const [tried, setTried] = useState(false);

  // Every opening starts from the entry being edited, or a blank line dated today.
  useEffect(() => {
    if (!visible) return;
    setDate(entry?.date ?? todayISO());
    setParticulars(entry?.particulars ?? "");
    setDebit(amountText(entry?.debit));
    setCredit(amountText(entry?.credit));
    setInterest(amountText(entry?.interest));
    setTried(false);
  }, [visible, entry]);

  const save = useMutation({
    mutationFn: (input: DayBookInput) => (entry ? updateDayBookEntry(entry.id, input) : createDayBookEntry(input)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["reports", "day-book"] });
      onSaved?.();
      onClose();
      toast.success(entry ? "Entry updated" : "Entry added");
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Could not save the entry — try again."),
  });

  const values = { debit: num(debit), credit: num(credit), interest: num(interest) };
  const errs: Record<string, string> = {};
  if (!date) errs.date = "Pick the date.";
  if (!particulars.trim()) errs.particulars = "Enter the particulars.";
  if (Object.values(values).some((v) => !Number.isFinite(v) || v < 0)) errs.amount = "Amounts must be zero or more.";
  else if (!values.debit && !values.credit && !values.interest) errs.amount = "Enter a debit, credit or interest amount.";
  const fe = (k: string) => (tried ? errs[k] : undefined);
  function submit() {
    if (Object.keys(errs).length) return setTried(true);
    save.mutate({ date, particulars: particulars.trim(), ...values });
  }
  const amountInput = (set: (v: string) => void) => (t: string) => {
    set(cleanAmount(t));
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={entry ? "Edit Day Book Entry" : "Day Book Entry"} maxHeightPct={92}>
      <Field label="Date *">
        <DateField value={date} max={todayISO()} onChange={setDate} />
      </Field>
      <FieldErr m={fe("date")} />
      <Field label="Particulars *">
        <Input placeholder="e.g. Office rent" value={particulars} maxLength={255} onChangeText={setParticulars} />
      </Field>
      <FieldErr m={fe("particulars")} />
      <FieldRow>
        <Field label="Debit (₹)">
          <Input placeholder="0" keyboardType="decimal-pad" value={debit} onChangeText={amountInput(setDebit)} />
        </Field>
        <Field label="Credit (₹)">
          <Input placeholder="0" keyboardType="decimal-pad" value={credit} onChangeText={amountInput(setCredit)} />
        </Field>
      </FieldRow>
      <FieldRow>
        <Field label="Interest (₹)">
          <Input placeholder="0" keyboardType="decimal-pad" value={interest} onChangeText={amountInput(setInterest)} />
        </Field>
      </FieldRow>
      <FieldErr m={fe("amount")} />
      <PrimaryButton label={entry ? "Save Changes" : "Add Entry"} onPress={submit} loading={save.isPending} />
    </Sheet>
  );
}
