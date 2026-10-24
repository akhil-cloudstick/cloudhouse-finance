import type { LegalDocumentSource } from "@/modules/legal/types/legal-types";
import { GOVERNING_COURTS } from "@/modules/legal/content/legalConfig";

export const termsAndConditions: LegalDocumentSource = {
  title: "Terms & Conditions",
  summary: "The terms on which {{provider}} provides {{app}}.",
  sections: [
    { heading: "1. Acceptance", body: ["By using {{app}} you agree to these terms. If you do not agree, do not use it."] },
    {
      heading: "2. The service",
      body: [
        { only: "customer", text: "{{app}} lets you view your loans, dues, payments and statements held by your lender." },
        { only: "staff", text: "{{app}} lets authorised staff manage customers, loans, payments, packets and reports." },
      ],
    },
    {
      heading: "3. Accounts",
      body: [
        "Give accurate information and keep your sign-in secure. You are responsible for activity under your account.",
        { only: "customer", text: "Never share your one-time password." },
        { only: "staff", text: "Do not share your login." },
      ],
    },
    {
      heading: "4. Acceptable use",
      list: [
        "No unlawful use.",
        "No attempts to break, probe or overload the service.",
        "No uploading of false or unlawful documents.",
        "No use of another person's account.",
      ],
    },
    {
      heading: "5. Loans are separate agreements",
      body: ["Your loan is governed by the agreement between you and the lender. The app only displays information; interest, charges and dues are as per that agreement."],
    },
    { heading: "6. Payments", body: ["Payments are made to the lender and appear in the app after they are recorded."] },
    { heading: "7. Availability", body: ["We aim for continuous service but do not guarantee it is uninterrupted or error-free."] },
    { heading: "8. Liability", body: ["To the extent the law allows, we are not liable for indirect losses arising from use of the app or its downtime."] },
    { heading: "9. Termination", body: ["We may suspend access for misuse or where the law requires. You can stop at any time; see Account Deletion."] },
    { heading: "10. Changes", body: ["We may update these terms. Continued use means you accept the updated terms."] },
    { heading: "11. Governing law", body: [`These terms are governed by the laws of India; disputes go to ${GOVERNING_COURTS}.`] },
    { heading: "12. Contact", body: ["{{provider}}, {{address}}. Email {{email}}. Phone {{phone}}."] },
  ],
};
