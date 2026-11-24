"use client";

import { Icon } from "@/common/components/Icon";
import { useModal } from "@/common/components/ModalProvider";

export type ExportKind = "xlsx" | "pdf";

export function ExportFormatModal({ onPick }: { onPick: (kind: ExportKind) => void }) {
  const { closeModal } = useModal();
  const pick = (kind: ExportKind) => {
    closeModal();
    onPick(kind);
  };
  return (
    <>
      <div className="hd"><h3>Export report</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd">
        <p style={{ marginTop: 0 }}>Choose the format to export or print this report.</p>
      </div>
      <div className="ft">
        <button className="btn" onClick={() => pick("xlsx")}><Icon name="download" /> Excel</button>
        <button className="btn" onClick={() => pick("pdf")}><Icon name="download" /> PDF</button>
      </div>
    </>
  );
}

/* One "Export" button shared by every report; it asks for Excel or PDF in a modal. Its
 * height is pinned to the search box and filter button beside it (34px). */
export function ExportMenu({ busy, onExport }: { busy: ExportKind | null; onExport: (kind: ExportKind) => void }) {
  const { openModal } = useModal();
  return (
    <button
      type="button"
      className="btn sm"
      style={{ height: 34 }}
      disabled={busy !== null}
      onClick={() => openModal(<ExportFormatModal onPick={onExport} />)}
    >
      <Icon name="download" /> {busy ? "Exporting…" : "Export"}
    </button>
  );
}
