import type { LegalDocumentSource } from "@/modules/legal/types/legal-types";

export const privacyPolicy: LegalDocumentSource = {
  title: "Privacy Policy",
  summary: "How {{provider}} collects, uses and protects your information when you use {{app}}.",
  sections: [
    {
      heading: "1. Who we are",
      body: [
        "{{app}} is provided by {{provider}}, {{address}} (“we”, “us”).",
        { only: "staff", text: "This is the internal staff and field-agent policy. The app is for authorised employees and agents of the lender, not for the public or for loan applicants." },
        "You can reach us at {{email}} or {{phone}}.",
      ],
    },
    {
      heading: "2. Information we collect",
      list: [
        { only: "customer", text: "Your name, mobile number, address and KYC details (such as Aadhaar or PAN numbers and documents) that your lender holds about you; your loan, interest and payment records; and the one-time password sent to your mobile number to sign you in." },
        { only: "staff", text: "Your name, login ID and role; the customer, loan, payment and KYC records you enter or view while working; and photographs and documents you capture or upload with the camera, photo library or file picker." },
        "Device and technical information: device type, app version, push-notification token, error and diagnostic logs and IP address, used to keep the service secure and working and to send notifications.",
        "We do not collect your location, contacts or microphone data, and we do not use advertising identifiers.",
      ],
    },
    {
      heading: "3. How we use it",
      list: [
        "To sign you in and verify your identity.",
        "To show and manage loans, payments and statements.",
        "To meet legal, KYC and anti-money-laundering duties.",
        "To send service messages such as payment reminders.",
        "To detect fraud, secure the service and support you.",
      ],
    },
    {
      heading: "4. Device permissions",
      list: [
        { only: "staff", text: "Camera: to scan business and packet QR codes and to photograph KYC documents." },
        { only: "staff", text: "Photos and files: to attach documents you choose." },
        { only: "customer", text: "Biometric unlock (optional): your fingerprint or face stays on your device; we never receive or store it." },
        { only: "customer", text: "Internet access: to load your loans and to open the secure Razorpay payment screen when you pay. The app does not use your location, contacts, camera or microphone." },
      ],
    },
    {
      heading: "5. Sharing",
      body: ["We do not sell your personal data. We share it only:"],
      list: [
        "with the lender (business) that holds your account;",
        "with service providers acting for us — hosting, SMS or WhatsApp delivery, payment and identity-verification partners — under confidentiality;",
        { only: "customer", text: "with Razorpay, our payment processor, when you pay a loan instalment: card, UPI or bank details are entered on Razorpay's screen and are processed by Razorpay under its own privacy policy; we do not receive or store them, and only receive the payment status, amount and reference;" },
        "with authorities, when the law requires it.",
      ],
    },
    {
      heading: "6. Storage and security",
      body: [
        "Data travels over encrypted connections (HTTPS). Sign-in tokens are kept in your device's secure storage, and access inside the service is limited by role. No system is completely secure, so we cannot guarantee absolute security.",
      ],
    },
    {
      heading: "7. Retention",
      body: [
        "We retain personal information for as long as necessary to provide the service, maintain your account and meet applicable legal, regulatory, accounting and record-keeping obligations. Certain loan, payment and KYC records may need to be kept after account deletion and are then restricted to compliance use. When information is no longer required, we delete or anonymise it, subject to applicable law.",
      ],
    },
    {
      heading: "8. Your rights",
      body: [
        "You may ask to access or correct your data, to withdraw consent, or to have your data deleted, subject to the legal retention above.",
        "Account deletion: to request deletion, follow the steps on the Account Deletion page or write to {{email}} from your registered address. We verify your identity and tell you the expected processing time; the Account Deletion page lists what is deleted and which records we must keep. Uninstalling the app does not delete your account.",
      ],
    },
    { heading: "9. Children", body: ["The app is not for anyone under 18."] },
    { heading: "10. Changes", body: ["When this policy changes we update this page and its date."] },
    {
      heading: "11. Grievance contact",
      body: ["{{provider}}, {{address}}. Email {{email}}. Phone {{phone}}."],
    },
  ],
};
