import type { FormEvent, ReactNode } from "react";

type ConsoleModalProps = {
  title: string;
  wide?: boolean | undefined;
  onClose: () => void;
  onSubmit?: (() => void) | undefined;
  /** Extra content under the title (a subtitle, steps). */
  head?: ReactNode;
  /** The footer's buttons, usually ModalFoot. */
  foot?: ReactNode;
  /** The body: wrap it in .sa-modal-body (scrolls while header and footer stay). */
  children: ReactNode;
};

/** A centred console dialog with a pinned header and footer; only the body scrolls. A click on the backdrop closes it. */
export function ConsoleModal({ title, wide, onClose, onSubmit, head, foot, children }: ConsoleModalProps) {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit?.();
  };
  return (
    <div className="sa-modal-backdrop" onClick={onClose}>
      <form className={`sa-modal${wide ? " wide" : ""}`} onClick={(event) => event.stopPropagation()} onSubmit={submit}>
        <div className="sa-modal-head">
          <h2>{title}</h2>
          {head}
        </div>
        {children}
        {foot && <div className="sa-modal-foot">{foot}</div>}
      </form>
    </div>
  );
}

/** Cancel plus one submit button: the footer most console dialogs use. */
export function ModalFoot({
  onCancel,
  label,
  pending,
  danger,
  disabled,
}: {
  onCancel: () => void;
  label: string;
  pending?: boolean | undefined;
  danger?: boolean | undefined;
  disabled?: boolean | undefined;
}) {
  return (
    <>
      <span className="sa-foot-spacer" />
      <button type="button" className="sa-btn" onClick={onCancel} disabled={pending}>
        Cancel
      </button>
      <button type="submit" className={`sa-btn ${danger ? "danger" : "primary"}`} disabled={pending || disabled}>
        {pending ? "Working…" : label}
      </button>
    </>
  );
}
