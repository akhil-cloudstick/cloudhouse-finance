import { C, Txt } from "@/common/components/ui";

type ErrorTextProps = { children?: string | null };

/** Red error line shown just above a sheet's confirm button. */
export function ErrorText({ children }: ErrorTextProps) {
  if (!children) return null;
  return <Txt style={{ color: C.red, fontSize: 12, fontWeight: "600", marginBottom: 10 }}>{children}</Txt>;
}

(ErrorText as { stickyFooter?: boolean }).stickyFooter = true;
