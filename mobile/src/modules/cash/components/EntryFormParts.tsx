import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AsyncSelect, C, Field, Input, Txt } from "@/common/components/ui";
import { useAuth } from "@/common/providers/AuthProvider";
import { userMessage } from "@/common/services/apiErrors";
import { createBank, listBanksPage } from "@/modules/banks/services/bankService";
import type { Bank } from "@/modules/banks/types/bank-types";
import { listBranchesPage } from "@/modules/branches/services/branchService";
import { getLoanBalance } from "@/modules/cash/services/cashService";

// Pieces shared by the Credit / Debit / Self Transfer entry forms
// (EntryForms.tsx) and their payment breakdown (PaymentBreakdownFields.tsx).

export const errMsg = (err: unknown, fallback: string) => userMessage(err, fallback);

// "Gold Sale" is a real row of the category list (returned by the server);
// picking it turns the Credit form into the gold-sale form and posts to
// /gold-sales (same as web's AddCashModal; the backend refuses a real source
// by this name, so it's never "flipped" to common either).
export const GOLD_SALE = "Gold Sale";
export const GOLD_SALE_MODES = ["Cash", "UPI", "Bank Transfer"] as const;
export const SELF_MODES = ["Bank Transfer", "UPI", "Cash"] as const;

// A name starting with "Loan" is one bank loan (same rule as web's isLoanSource).
export const isLoanSource = (name: string) => name.trim().toLowerCase().startsWith("loan");

// A search also returns categories that belong to another form. Picking one
// from another form that isn't common yet flips it to common — the same
// find-or-create POST the picker's "add" uses (fire-and-forget).
export function flipToCommon(item: { name: string; type?: string; isCommon?: boolean }, own: string, post: (name: string) => Promise<unknown>) {
  if (item.type && item.type !== own && !item.isCommon && item.name !== GOLD_SALE) post(item.name).catch(() => {});
}

// The balance of the loan a category stands for — undefined while loading, or
// when it isn't a loan with its details on file. Fresh on every open.
export function useLoanBalance(cat: { id: number; name: string; principalAmount?: number } | null) {
  const id = cat && cat.id > 0 && isLoanSource(cat.name) && cat.principalAmount != null ? cat.id : 0;
  const q = useQuery({ queryKey: ["loan-balance", id], queryFn: () => getLoanBalance(id), enabled: id > 0, staleTime: 0, gcTime: 0 });
  return id > 0 ? q.data ?? null : null;
}

type LoanWarningProps = { text: string };

export function LoanWarning({ text }: LoanWarningProps) {
  return text ? <Txt style={{ fontSize: 12.5, color: C.red, marginBottom: 10 }}>{text}</Txt> : null;
}

export type BranchPick = { id: number; name: string };

type BranchFieldProps = { branch: BranchPick | null; onChange: (b: BranchPick) => void };

// Branch — a cross-branch user picks one, everyone else books into their own
// branch (read-only; also the lock for a single-branch business).
export function BranchField({ branch, onChange }: BranchFieldProps) {
  const { can } = useAuth();
  if (can("Branch_Management", "can_view_all_branches")) {
    return (
      <AsyncSelect<{ id: number; name: string; code?: string }>
        label="Branch"
        placeholder="Search branch"
        queryKey={["branches", "entry-picker"]}
        fetcher={async (q) => (await listBranchesPage({ q: q || undefined, active: true, limit: 20, offset: 0 })).items ?? []}
        selectedLabel={branch?.name}
        onSelect={(b) => onChange({ id: b.id, name: b.name })}
        keyOf={(b) => b.id}
        renderItem={(b) => ({ title: b.name, sub: b.code })}
      />
    );
  }
  return (
    <Field label="Branch">
      <Input value={branch?.name ?? ""} editable={false} />
    </Field>
  );
}

// The user's own branch to start from; an edit starts from the entry's branch.
export function useOwnBranch(initial?: BranchPick | null) {
  const { employee } = useAuth();
  return useState<BranchPick | null>(initial ?? (employee ? { id: employee.branchId, name: employee.branch?.name ?? "Your branch" } : null));
}

type BankPickerProps = { label: string; bank: Bank | null; onChange: (b: Bank | null) => void };

export function BankPicker({ label, bank, onChange }: BankPickerProps) {
  const canCreateBank = useAuth().can("Bank_Management", "can_create_bank");
  return (
    <AsyncSelect<Bank>
      label={label}
      placeholder="Search or add a bank"
      queryKey={["banks", "picker"]}
      fetcher={async (q) => (await listBanksPage({ q: q || undefined, limit: 20, offset: 0 })).items ?? []}
      selectedLabel={bank?.name}
      onSelect={onChange}
      onClear={() => onChange(null)}
      keyOf={(b) => b.id}
      renderItem={(b) => ({ title: b.name })}
      onCreateNew={canCreateBank ? (name) => createBank({ name }) : undefined}
    />
  );
}
