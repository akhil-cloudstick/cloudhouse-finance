"use client";

import { useCallback, useEffect, useState } from "react";
import { useModal } from "@/common/components/ModalProvider";
import { useToast } from "@/common/components/ToastProvider";
import { Icon } from "@/common/components/Icon";
import { ApiError } from "@/common/services/httpClient";
import { searchSelectableExpenseCategoriesPage, deleteExpenseCategory } from "@/modules/cash/services/expenseCategoryService";
import { type BackendExpenseCategory } from "@/modules/cash/types/expense-category-types";
import { searchCategoriesPage, deleteCategoryById } from "@/modules/cash/services/categoryService";
import { type CategoryType } from "@/modules/cash/types/category-types";

/* Expense Register categories live in their own list; Credit, Debit and Self Transfer share one table. */
type Kind = "register" | CategoryType;
const KINDS: { key: Kind; label: string }[] = [
  { key: "register", label: "Expenses" },
  { key: "cash_in", label: "Credit" },
  { key: "expense", label: "Debit" },
  { key: "self_transfer", label: "Self transfer" },
];

/* Lists the expense categories that can be picked on the expense form and lets staff delete
 * one that is no longer wanted. The system categories (Auction, Bank Pledge Release) are not
 * listed, and the server refuses a category that ledger entries still use, saying how many. */
export function ManageCategoriesModalContent({ initialKind = "register" }: { initialKind?: Kind } = {}) {
  const [kind, setKind] = useState<Kind>(initialKind);
  const { closeModal } = useModal();
  const toast = useToast();
  const [items, setItems] = useState<BackendExpenseCategory[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback((p: number) => {
    setLoading(true);
    const fetchPage = kind === "register"
      ? searchSelectableExpenseCategoriesPage("", p)
      : searchCategoriesPage(kind)("", p);
    fetchPage
      .then((res) => { setItems(res.items); setHasMore(res.hasMore); setPage(p); setErr(""); })
      .catch(() => setErr("Could not load the categories — try again."))
      .finally(() => setLoading(false));
  }, [kind]);
  useEffect(() => { setConfirmId(null); load(0); }, [load]);

  async function remove(c: BackendExpenseCategory) {
    setBusyId(c.id);
    setErr("");
    try {
      if (kind === "register") await deleteExpenseCategory(c.id);
      else await deleteCategoryById(c.id);
      toast(`Category "${c.name}" deleted`);
      setConfirmId(null);
      // Step back a page if that was the last row of this one.
      load(items.length === 1 && page > 0 ? page - 1 : page);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not delete this category — try again.");
      setConfirmId(null);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <div className="hd"><h3>Manage Categories</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd bd-scroll">
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
          {KINDS.map((k) => (
            <button key={k.key} type="button" className={`btn sm ${kind === k.key ? "" : "ghost"}`} onClick={() => { setKind(k.key); setErr(""); }}>{k.label}</button>
          ))}
        </div>
        {err && <div className="err" style={{ marginBottom: 10 }}>{err}</div>}
        {loading ? <div className="empty compact">Loading…</div> : items.length === 0 ? <div className="empty compact">No categories.</div> : (
          <div className="tbl-wrap"><table className="tbl">
            <tbody>
              {items.map((c) => (
                <tr key={c.id}>
                  <td data-label="Category">{c.name}</td>
                  <td style={{ textAlign: "right" }}>
                    {confirmId === c.id ? (
                      <>
                        <button className="btn sm danger" disabled={busyId === c.id} onClick={() => remove(c)}>{busyId === c.id ? "Deleting…" : "Confirm delete"}</button>{" "}
                        <button className="btn ghost sm" disabled={busyId === c.id} onClick={() => setConfirmId(null)}>Cancel</button>
                      </>
                    ) : (
                      <button className="btn ghost sm" onClick={() => { setErr(""); setConfirmId(c.id); }} title="Delete category"><Icon name="trash" /> Delete</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
        <div className="ft" style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
          <button className="btn plain sm" disabled={page <= 0 || loading} onClick={() => load(page - 1)}>‹ Prev</button>
          <span style={{ fontSize: 12.5 }}>Page {page + 1}</span>
          <button className="btn plain sm" disabled={!hasMore || loading} onClick={() => load(page + 1)}>Next ›</button>
        </div>
        <div className="ft" style={{ marginTop: 8 }}>A category that expenses or ledger entries still use cannot be deleted.</div>
      </div>
      <div className="ftr"><button className="btn ghost" onClick={closeModal}>Close</button></div>
    </>
  );
}
