import { useEffect } from "react";
import { C, Txt } from "@/common/components/ui";
import { toast } from "@/common/components/ui/ToastHost";

type ErrorTextProps = { children?: string | null };

/** Red error line shown just above a sheet's confirm button. */
export function ErrorText({ children }: ErrorTextProps) {
  // Sheet errors sit above the footer, often below the fold: also raise them as a toast.
  useEffect(() => { if (children) toast.error(children); }, [children]);
  if (!children) return null;
  return <Txt style={{ color: C.red, fontSize: 12, fontWeight: "600", marginBottom: 10 }}>{children}</Txt>;
}

/** Red message right under the field it is about (same markup as CreateLoanSheet / SchemeSheet). */
export function FieldErr({ m }: { m?: string | null }) {
  return m ? <Txt style={{ fontSize: 12, color: C.red, fontWeight: "600", marginTop: -6, marginBottom: 10 }}>{m}</Txt> : null;
}

(ErrorText as { stickyFooter?: boolean }).stickyFooter = true;
