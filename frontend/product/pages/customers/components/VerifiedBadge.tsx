"use client";

import { Icon } from "@/product/components/Icon";
import { verificationLabel } from "@/product/pages/customers/services/customerService";

/* A small "Verified" pill for a customer, rendered ONLY when the customer
 * is fully verified (both PAN and Aadhaar — see customerService's
 * verificationLabel). "Part Verified"/"Unverified" deliberately render
 * nothing at all rather than their own chip: in the customer *pickers*
 * (NewLoan.tsx's gold-loan picker and NewPersonalLoanModal.tsx's personal-
 * loan picker) the row is meant to read as just the customer's name, with
 * the badge as a positive marker — the absence of a badge is the "not
 * verified" state, so no negative text is shown. Verification is still
 * spelled out in full on the Customers list/detail pages (StatusChip per
 * PAN/Aadhaar), which is where that detail belongs.
 */
export function VerifiedBadge({ customer }: { customer: { panStatus: string; aadhaarStatus: string } }) {
  if (verificationLabel(customer) !== "Verified") return null;
  return (
    <span className="vbadge" title="PAN and Aadhaar verified">
      <Icon name="check" />
      Verified
    </span>
  );
}
