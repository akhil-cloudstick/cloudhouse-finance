"use client";

import { useState } from "react";
import { useModal } from "@/common/components/ModalProvider";
import { Icon } from "@/common/components/Icon";
import { useAuth } from "@/common/providers/AuthProvider";
import { BankModalContent } from "@/modules/banks/components/BankModalContent";
import { BankTable } from "@/modules/banks/components/BankTable";
import { balanceColor, fmtBalance } from "@/modules/banks/utils/bankBalance";

/* Centralized bank management — mirrors Branches.tsx exactly (simple CRUD
 * table). Unlike Branches, deleting a bank really deletes it (hard delete,
 * guarded by a reference count) rather than deactivating it — see backend
 * Service.Delete's doc comment — so a bank still referenced by history is
 * blocked with a warning naming how many transactions/pledges are linked,
 * pointing staff at "Merge" instead.
 *
 * Paginated server-side via listBanksPage (GET /banks?limit=&offset=) —
 * same {items, hasMore, total} envelope as Loans.tsx's listLoansPage. */
export function BanksPage() {
  const { openModal } = useModal();
  const { can } = useAuth();
  const canCreate = can("Bank_Management", "can_create_bank");
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((k) => k + 1);
  // Net balance across every listed bank — the server's `totalBalance` from
  // the same GET /banks response the table renders, so it always equals the
  // sum of the Balance column (scoped by the global branch selection). Null
  // (card hidden) until the list has loaded.
  const [bankBalance, setBankBalance] = useState<number | null>(null);

  return (
    <>
      <div className="page-h">
        <div><h1>Bank Management</h1><p>Add, edit and manage the banks used for re-pledging gold, split payments and the Party Transactions ledger</p></div>
        <div className="sp" />
        {canCreate && <button className="btn" onClick={() => openModal(<BankModalContent onSaved={reload} />)}><Icon name="plus" /> Add Bank</button>}
      </div>
      <hr className="gold-rule" />
      {bankBalance !== null && (
        <div className="kpis" style={{ marginBottom: 16 }}>
          <div className="kpi"><div className="l">Net Bank Balance</div><div className="v" style={{ color: balanceColor(bankBalance) }}>{fmtBalance(bankBalance)}</div></div>
        </div>
      )}
      <BankTable reloadKey={reloadKey} afterChange={reload} onTotalBalance={setBankBalance} />
    </>
  );
}
