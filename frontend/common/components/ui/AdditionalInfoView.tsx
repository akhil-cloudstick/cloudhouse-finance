"use client";

import { useModal } from "@/common/components/ModalProvider";
import { Icon } from "@/common/components/Icon";

/* Modal body for a loan's "Additional Information" (max 150 chars): the text wraps and shows about three rows,
 * then scrolls with no visible scrollbar. */
export function AdditionalInfoModalContent({ text, title = "Additional Information" }: { text: string; title?: string }) {
  const { closeModal } = useModal();
  return (
    <>
      <div className="hd"><h3>{title}</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd">
        <div className="addl-info" style={{ whiteSpace: "pre-wrap" }}>{text}</div>
      </div>
    </>
  );
}

/* Shared "view" trigger: shows a link-style button that opens the text in a modal. Renders nothing when empty.
 * Use this on every page that displays a loan's additional information. */
export function AdditionalInfoView({ text }: { text?: string | null }) {
  const { openModal } = useModal();
  const t = (text || "").trim();
  if (!t) return null;
  return (
    <button type="button" className="btn sm ghost" title="View" aria-label="View additional information"
      onClick={() => openModal(<AdditionalInfoModalContent text={t} />)}>
      <Icon name="eye" />
    </button>
  );
}
