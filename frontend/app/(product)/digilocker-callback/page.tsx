"use client";

import { Suspense } from "react";
import BrandLogo from "@/product/components/BrandLogo";
import { useSearchParams } from "next/navigation";
import "@/product/styles/login.css";

/* Where Setu's DigiLocker sends the CUSTOMER's own browser tab back to once
 * they finish Aadhaar + OTP login (see CustomerDetail.tsx's
 * sendAadhaarVerificationLink, which opens the DigiLocker URL in a new tab
 * with this page as redirectUrl). This page has nothing to do — the actual
 * verification result is fetched separately when staff click "Check Status"
 * back in the original tab (CheckAadhaarVerify polls Setu by the stored
 * request id, keyed to the customer, not to anything in this URL) — so it
 * just confirms what happened and tells the customer they can close the tab.
 * Before this page existed, DigiLocker's redirect landed on Next's plain
 * 404, which looked like the verification itself had failed. */
function DigilockerCallbackContent() {
  const searchParams = useSearchParams();
  const success = searchParams.get("success") === "True";

  return (
    <div className="login-page">
      <div className="wrap">
        <main className="card">

          <div className="brand">
            <BrandLogo size={104} scalable={false} />
            <h1>
              {success ? (
                <>DigiLocker login complete</>
              ) : (
                <>DigiLocker login didn't complete</>
              )}
            </h1>
          </div>

          <p style={{ textAlign: "center", color: "var(--muted, #62626f)", lineHeight: 1.6 }}>
            {success
              ? "You can close this tab now. Ask the staff member helping you to check the verification status back on their screen."
              : "The DigiLocker login was cancelled or didn't finish. You can close this tab and ask the staff member to send a new verification link."}
          </p>
        </main>
      </div>
    </div>
  );
}

export default function DigilockerCallbackPage() {
  return (
    <Suspense fallback={null}>
      <DigilockerCallbackContent />
    </Suspense>
  );
}
