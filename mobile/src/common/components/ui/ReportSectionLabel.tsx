import { Txt } from "./Txt";
import { s } from "./rowContext";

type ReportSectionLabelProps = { children: string };

/** .report-section-label + .report-row */
export function ReportSectionLabel({ children }: ReportSectionLabelProps) {
  return <Txt style={s.reportLabel}>{children.toUpperCase()}</Txt>;
}
