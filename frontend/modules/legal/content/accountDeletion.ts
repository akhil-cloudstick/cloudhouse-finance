import type { LegalDocumentSource } from "@/modules/legal/types/legal-types";
import {
  BACKUP_PURGE_DAYS,
  DELETION_COMPLETE_DAYS,
  DELETION_REPLY_DAYS,
} from "@/modules/legal/content/legalConfig";

export const accountDeletion: LegalDocumentSource = {
  title: "Account Deletion",
  summary: "How to ask {{provider}} to delete your account and data for {{app}}.",
  sections: [
    {
      heading: "How to request deletion",
      body: [
        { only: "customer", text: `Email {{email}} from your registered address, or call {{phone}}, with your name, your registered mobile number and the subject “Delete my account”. We verify your identity and reply within ${DELETION_REPLY_DAYS} days.` },
        { only: "staff", text: "Ask your business administrator, or email {{email}}, to disable your login. We verify the request before acting." },
        "Uninstalling the app does not delete your account.",
      ],
    },
    {
      heading: "What is deleted",
      list: [
        "Your profile details and sign-in credentials.",
        "Device tokens and notification preferences.",
        "Uploaded photos and documents that are not needed for a legal record.",
      ],
    },
    {
      heading: "What we must keep",
      body: [
        "Loan, interest, payment and KYC records that we are legally required to retain are kept for the period the law requires and used only for compliance. An account with an active loan cannot be fully deleted until the loan is closed.",
      ],
    },
    {
      heading: "Timeline",
      body: [
        `Deletion is completed within ${DELETION_COMPLETE_DAYS} days of a verified request. Backups are overwritten within ${BACKUP_PURGE_DAYS} days.`,
      ],
    },
  ],
};
