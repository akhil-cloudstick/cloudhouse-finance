"use client";

import { useModal } from "@/common/components/ModalProvider";
import { Icon } from "@/common/components/Icon";
import { useAuth } from "@/common/providers/AuthProvider";
import { BankModalContent } from "@/modules/banks/components/BankModalContent";
import { BankTable } from "@/modules/banks/components/BankTable";

/* The same bank list as a modal — Bank Pledge's "Banks" button. Every child
 * modal (add/edit/delete) replaces this one, so afterChange reopens it with
 * a fresh list once the child is done. */
export function BanksModalContent() {
  const { openModal, closeModal } = useModal();
  const { can } = useAuth();
  const canCreate = can("Bank_Management", "can_create_bank");
  const reopen = () => openModal(<BanksModalContent />, true);

  return (
    <>
      <div className="hd">
        <h3>Banks</h3>
        <div className="sp" />
        {canCreate && <button className="btn sm" onClick={() => openModal(<BankModalContent onSaved={reopen} />)}><Icon name="plus" /> Add Bank</button>}
        <button className="x" onClick={closeModal}>×</button>
      </div>
      <div className="bd bd-scroll bd-tbl">
        <BankTable reloadKey={0} afterChange={reopen} inModal />
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Back</button>
      </div>
    </>
  );
}
