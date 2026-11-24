import { useQuery } from "@tanstack/react-query";
import { Buffering, C, FieldGrid, Sheet, Txt } from "@/common/components/ui";
import { getInvestor } from "@/modules/investments/services/investorService";
import { loadErrorText } from "@/common/services/apiErrors";

type InvestorProfileSheetProps = { customerId: number | null; visible: boolean; onClose: () => void };

/** Read-only profile of an investment's investor (web InvestorProfileModalContent), opened from the investment detail header. */
export function InvestorProfileSheet({ customerId, visible, onClose }: InvestorProfileSheetProps) {
  const q = useQuery({ queryKey: ["investor", String(customerId)], queryFn: () => getInvestor(customerId!), enabled: visible && !!customerId });
  const i = q.data;
  const v = (x?: string | number | null) => (x ? String(x) : "—");
  return (
    <Sheet visible={visible} onClose={onClose} title="Investor Profile" maxHeightPct={85}>
      {q.isLoading ? <Buffering block /> : null}
      {q.isError ? <Txt style={{ fontSize: 12.5, color: C.red }}>{loadErrorText(q.error) ?? "Could not load the investor."}</Txt> : null}
      {i ? (
        <FieldGrid
          style={{ marginTop: 10, marginBottom: 10 }}
          items={[
            { k: "Name", v: v(i.name) },
            { k: "Customer code", v: v(i.code) },
            { k: "Phone", v: v(i.phone) },
            { k: "Address", v: v(i.address) },
            { k: "Branch", v: v(i.branch?.name) },
            { k: "PAN", v: v(i.pan) },
            { k: "Aadhaar", v: i.aadhaarLast4 ? `XXXX XXXX ${i.aadhaarLast4}` : "—" },
            { k: "Bank account name", v: v(i.bankAccountName) },
            { k: "Bank account no.", v: v(i.bankAccountNumber) },
            { k: "IFSC", v: v(i.bankIfsc) },
          ]}
        />
      ) : null}
    </Sheet>
  );
}
