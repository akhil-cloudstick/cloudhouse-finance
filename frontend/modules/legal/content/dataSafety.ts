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
          { only: "customer", row: ["Name, phone number, address", "Yes", "With your lender", "Account and sign-in"] },
          { only: "staff", row: ["Your name, login ID and role", "Yes", "With the lender you work for", "Account and sign-in"] },
          { only: "customer", row: ["Government ID details (KYC)", "Yes", "With your lender", "Legal KYC duties"] },
          { only: "staff", row: ["Customer KYC details you enter", "Passed to the lender's account", "With the lender only", "Verification by the lender; we do not use it for any other purpose"] },
          { only: "customer", row: ["Loan and payment records", "Yes", "With your lender", "App functionality"] },
          { only: "staff", row: ["Loan and payment records you enter", "Passed to the lender's account", "With the lender only", "App functionality"] },
          { only: "customer", row: ["Payment status and reference", "Yes", "With Razorpay and your lender", "Loan repayment; card, UPI and bank details are entered with Razorpay and not seen by us"] },
          { only: "staff", row: ["Photos and files you capture or choose", "Passed to the lender's account", "With the lender only", "KYC documents for verification"] },
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
    {
      heading: "Deletion",
      body: [
        { only: "customer", text: "You can ask for your data to be deleted — see Account Deletion." },
        { only: "staff", text: "Accounts are provisioned by backend administrators and cannot be created in the app. To disable your login or request deletion, contact your administrator — see Account Deletion." },
      ],
    },
  ],
};
