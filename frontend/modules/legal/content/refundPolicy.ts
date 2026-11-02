import type { LegalDocumentSource } from "@/modules/legal/types/legal-types";
import { REFUND_WORKING_DAYS } from "@/modules/legal/content/legalConfig";

export const refundPolicy: LegalDocumentSource = {
  title: "Refund & Cancellation Policy",
  summary: "How payments, refunds and cancellations work with {{app}}.",
  sections: [
    {
      heading: "The app",
      body: [
        { only: "customer", text: "{{app}} is free for customers; we charge customers no fee for using it." },
        { only: "staff", text: "Subscription, plan changes and cancellation for a business are per its agreement with {{provider}}. Call {{phone}}." },
      ],
    },
    {
      heading: "Loan payments",
      body: [
        "Payments toward a loan are made to the lender and credited against the loan. They are not refundable through the app. A refund of an incorrect or duplicate payment is decided and processed by the lender — contact them, or call {{phone}}, with the payment reference.",
      ],
    },
    {
      heading: "Payment gateway refunds",
      body: [`Where a payment gateway is used, an approved refund returns to the original payment method in ${REFUND_WORKING_DAYS} working days.`],
    },
  ],
};
