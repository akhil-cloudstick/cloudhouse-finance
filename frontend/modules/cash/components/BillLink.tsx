"use client";

import { useModal } from "@/common/components/ModalProvider";
import { BillViewModalContent } from "@/modules/cash/components/BillViewModalContent";

type BillLinkProps = { url?: string; title: string };

/* "View bill" link for a ledger entry that has an uploaded bill — opens the
 * image in the same viewer the Expense Register's receipt thumbnail uses. */
export function BillLink({ url, title }: BillLinkProps) {
  const { openModal } = useModal();
  if (!url) return null;
  return (
    <a
      href={url}
      style={{ display: "inline-block", fontSize: 11.5, marginLeft: 8, whiteSpace: "nowrap" }}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); openModal(<BillViewModalContent title={title} url={url} />, true); }}
    >
      View bill
    </a>
  );
}
