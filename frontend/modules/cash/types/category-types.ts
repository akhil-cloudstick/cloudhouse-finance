import type { BackendCashSource } from "@/modules/cash/types/cash-source-types";

/* The unified category list (backend/internal/cash/model.go's Category) —
 * one table behind the Credit, Debit and Self Transfer pickers, told apart by
 * `type`. A category with isCommon is offered on every form. Same row shape
 * as a cash source (loan details included), so it reuses BackendCashSource. */
export type CategoryType = "cash_in" | "expense" | "self_transfer";
export type BackendCategory = BackendCashSource & { type: CategoryType; isCommon: boolean };
