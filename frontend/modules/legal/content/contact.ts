import type { LegalDocumentSource } from "@/modules/legal/types/legal-types";
import { SUPPORT_HOURS, SUPPORT_RESPONSE_DAYS } from "@/modules/legal/content/legalConfig";

export const contact: LegalDocumentSource = {
  title: "Contact & Support",
  summary: "How to reach {{provider}} about {{app}}.",
  sections: [
    {
      heading: "Get in touch",
      list: ["Provider: {{provider}}", "Address: {{address}}", "Email: {{email}}", "Phone: {{phone}}", "Website: {{website}}"],
    },
    {
      heading: "Support hours",
      body: [`${SUPPORT_HOURS}. We reply within ${SUPPORT_RESPONSE_DAYS} working days.`],
    },
  ],
};
