import type { LegalDocumentSource } from "@/modules/legal/types/legal-types";

/* Mirrors the answers given in Google Play's "Data safety" form and Apple's
 * "App Privacy" questionnaire. Re-check it whenever an SDK is added. */
export const dataSafety: LegalDocumentSource = {
  title: "Data Safety",
  summary: "What data {{app}} handles, why, and who sees it.",
  sections: [
    {
      heading: "Data collected",
      table: {
        head: ["Data", "Collected", "Shared", "Purpose"],
        rows: [
          ["Name, phone number, address", "Yes", "With your lender", "Account and sign-in"],
          ["Government ID details (KYC)", "Yes", "With your lender", "Legal KYC duties"],
          ["Loan and payment records", "Yes", "With your lender", "App functionality"],
          ["Payment status and reference (customer app)", "Yes", "With Razorpay and your lender", "Loan repayment; card, UPI and bank details are entered with Razorpay and not seen by us"],
          ["Photos and files (staff app)", "Yes", "With your lender", "KYC documents"],
          ["Location, contacts, microphone", "No", "—", "—"],
          ["Push-notification token, analytics, crash reports", "No", "—", "—"],
          ["Advertising ID, browsing history", "No", "—", "—"],
        ],
      },
    },
    {
      heading: "Sharing",
      body: ["Shared only with the lender and the service providers named in the Privacy Policy. We do not sell data, show ads or track you across other apps."],
    },
    {
      heading: "Security",
      body: ["Data is encrypted in transit, sign-in tokens sit in your device's secure storage, and access is limited by role."],
    },
    { heading: "Deletion", body: ["You can ask for your data to be deleted — see Account Deletion."] },
  ],
};
