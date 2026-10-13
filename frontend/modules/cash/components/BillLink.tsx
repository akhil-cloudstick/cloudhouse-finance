"use client";

import { useModal } from "@/common/components/ModalProvider";
import { SafeImage } from "@/common/components/ui/SafeImage";
import { BillViewModalContent } from "@/modules/cash/components/BillViewModalContent";

type BillLinkProps = { url?: string; title: string };

/* A ledger entry's uploaded bill as a small image preview — click it to open
 * the same viewer the Expense Register's receipt thumbnail uses. */
export function BillLink({ url, title }: BillLinkProps) {
  const { openModal } = useModal();
  if (!url) return null;
  return (
    <SafeImage
      src={url}
      title="View bill"
      style={{ width: 28, height: 28, objectFit: "cover", borderRadius: 5, border: "1px solid var(--line)", cursor: "pointer", verticalAlign: "middle", marginLeft: 8 }}
      onClick={() => openModal(<BillViewModalContent title={title} url={url} />, true)}
    />
  );
}
