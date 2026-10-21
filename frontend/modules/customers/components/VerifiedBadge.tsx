"use client";

import { Icon } from "@/common/components/Icon";
import { verificationLabel } from "@/modules/customers/services/customerService";

type VerifiedBadgeProps = { customer: { panStatus: string; aadhaarStatus: string } };

// Renders nothing for "Part Verified"/"Unverified" — absence of the badge is the "not verified" state.
export function VerifiedBadge({ customer }: VerifiedBadgeProps) {
  if (verificationLabel(customer) !== "Verified") return null;
  return (
    <span className="vbadge" title="PAN and Aadhaar verified">
      <Icon name="check" />
      Verified
    </span>
  );
}
