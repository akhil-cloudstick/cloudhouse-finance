import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Buffering, Card, DetailRow, C, EmptyText, FlatHeader, PScroll, Screen, Txt } from "@/common/components/ui";
import { getBillingStatus } from "@/modules/billing/services/billingService";
import { dmy } from "@/common/utils/format";

// Billing & Plan — read-only: shows where the business stands (web's plain
// billing card). Payments and plan changes are done on the web dashboard or
// through support; nothing here simulates a payment.
const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  trial: "Trial",
  past_due: "Payment overdue",
  grace: "Payment pending — grace period",
  over_quota: "Over plan quota",
  suspended: "Suspended",
  cancelled: "Cancelled",
};

export default function BillingScreen() {
  const status = useQuery({ queryKey: ["billing", "status"], queryFn: getBillingStatus });

  const header = <FlatHeader title="Billing & Plan" subtitle="Your plan and its status" />;

  if (status.isPending) return <Screen header={header}><Buffering style={{ paddingVertical: 30 }} /></Screen>;
  if (status.isError) return <Screen header={header}><EmptyText>Couldn&apos;t load your plan. Try again from More.</EmptyText></Screen>;
  const st = status.data;
  const expired = !!st.subscriptionExpiresAt && new Date(st.subscriptionExpiresAt) < new Date();
  const canSubscribe = st.priceInPaise > 0 && (!st.hasSubscription || st.businessStatus === "suspended" || st.businessStatus === "cancelled");
  return (
    <Screen header={header}>
      <PScroll refreshing={status.isRefetching} onRefresh={() => { status.refetch(); }}>
        <Card style={{ marginTop: 14 }}>
          <DetailRow first k="Plan" v={st.tierName} />
          <DetailRow k="Price" v={st.priceInPaise > 0 ? `₹${(st.priceInPaise / 100).toLocaleString("en-IN")} / month` : "Not billed"} />
          <DetailRow k="Status" v={STATUS_LABELS[st.businessStatus] ?? st.businessStatus} />
          {st.subscriptionExpiresAt ? <DetailRow k={expired ? "Expired on" : "Renews on"} v={dmy(st.subscriptionExpiresAt)} /> : null}
        </Card>
        {st.gracePeriodEndsAt ? (
          <Txt style={{ color: C.red, fontSize: 13, marginTop: 10, paddingHorizontal: 18 }}>
            A recent payment attempt failed. Please renew before {dmy(st.gracePeriodEndsAt)} to avoid suspension.
          </Txt>
        ) : null}
        <Txt style={{ color: C.muted, fontSize: 13, marginTop: 10, paddingHorizontal: 18 }}>
          {st.priceInPaise <= 0
            ? "This plan has no billing price configured yet — contact support."
            : canSubscribe
              ? `${st.hasSubscription ? "Renew" : "Subscribe"} from the web dashboard's Billing page.`
              : "Your subscription renews automatically. To upgrade your plan, use the web dashboard or contact support."}
        </Txt>
      </PScroll>
    </Screen>
  );
}
