import type { LegalDocumentSource } from "@/modules/legal/types/legal-types";

export const disclaimer: LegalDocumentSource = {
  title: "Disclaimer",
  summary: "What the information in {{app}} does and does not promise.",
  sections: [
    {
      heading: "Information shown in the app",
      body: ["Balances, interest, due dates, gold rates and valuations shown in {{app}} are provided for convenience and may lag behind the lender's books. The lender's records and your signed agreement prevail."],
    },
    {
      heading: "Gold rates and valuations",
      body: ["Rates and valuations are indicative and change with the market. Nothing in the app is financial, legal or tax advice."],
    },
    {
      heading: "Our role",
      body: ["{{provider}} supplies the software. The loan itself is offered by the lender who gave it to you, and {{provider}} is not a party to that loan unless your agreement says so."],
    },
    {
      heading: "Third-party services",
      body: ["Links to payment, KYC or e-sign services are governed by those parties' own terms."],
    },
  ],
};
