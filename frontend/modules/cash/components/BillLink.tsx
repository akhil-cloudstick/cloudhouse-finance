"use client";

import { useModal } from "@/common/components/ModalProvider";
import { SafeImage } from "@/common/components/ui/SafeImage";
import { BillViewModalContent } from "@/modules/cash/components/BillViewModalContent";

type BillLinkProps = { url?: string; title: string };

export function BillLink({ url, title }: BillLinkProps) {
  // A child modal: Close returns to the entry card the bill was opened from instead of closing it too.
  const { openChildModal } = useModal();
  if (!url) return null;
  return (
    <SafeImage
      src={url}
      title="View bill"
      style={{ width: 28, height: 28, objectFit: "cover", borderRadius: 5, border: "1px solid var(--line)", cursor: "pointer", verticalAlign: "middle", marginLeft: 8 }}
      onClick={() => openChildModal(<BillViewModalContent title={title} url={url} />, true)}
    />
  );
}
