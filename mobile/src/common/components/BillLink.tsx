import React, { useState } from "react";
import { Pressable } from "react-native";
import { C, PIcon } from "@/common/components/ui";
import { BillSheet } from "./BillSheet";
import { LedgerLink } from "./LedgerLink";

// Shared by LedgerList and the cash entry actions/forms. Kept out of LedgerList.tsx because
// EntryActions / EntryForms importing it from there made a require cycle (LedgerList renders
// EntryActions). LedgerList re-exports all three, so existing imports keep working.

/** Query key of the expense category name -> id map (LedgerList's useExpenseCategoryIds) —
 * invalidate it when a category is created, or a new category has no ledger link until it's
 * refetched. */
export const EXPENSE_CATEGORY_IDS_KEY = ["expense-category-ids"];

// A ledger entry's bill — opens the uploaded image (server-root-relative URL).
export function billDetail(receiptImage?: string): { k: string; v: React.ReactNode }[] {
  if (!receiptImage) return [];
  return [{ k: "Bill", v: <BillLink path={receiptImage} /> }];
}

type BillLinkProps = { path: string; label?: string; /** Title of the viewer sheet — the name of the thing being viewed (default "Bill"). */ title?: string; /** Show an eye icon (accessibilityLabel "View document") instead of the text link. */ icon?: boolean; /** Adds a Replace button inside the viewer. */ onReplace?: () => void };

// Opens the bill in an in-app sheet that sends the session token (the server
// only serves /uploads/* to a signed-in caller) and falls back cleanly.
export function BillLink({ path, label = "View bill", title, icon, onReplace }: BillLinkProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {icon ? (
        <Pressable onPress={() => setOpen(true)} hitSlop={8} accessibilityRole="button" accessibilityLabel={title ? `View ${title}` : "View document"}>
          <PIcon name="eye" color={C.brandDeep} size={20} />
        </Pressable>
      ) : (
        <LedgerLink label={label} to="/cash" onPress={() => setOpen(true)} />
      )}
      <BillSheet path={open ? path : null} title={title} onClose={() => setOpen(false)} onReplace={onReplace ? () => { setOpen(false); onReplace(); } : undefined} />
    </>
  );
}
