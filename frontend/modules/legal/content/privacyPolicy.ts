import type { LegalDocumentSource } from "@/modules/legal/types/legal-types";

export const privacyPolicy: LegalDocumentSource = {
  title: "Privacy Policy",
  summary: "How {{provider}} collects, uses and protects your information when you use {{app}}.",
  sections: [
    {
      heading: "1. Who we are",
      body: [
        "{{app}} is software provided by {{provider}} (“we”, “us”). We are a software company: we do not offer, fund or collect loans.",
        { only: "staff", text: "This app is business software for the authorised employees and field agents of the licensed lenders that use {{app}}. It is not for the public or for loan applicants. Accounts cannot be created within the app; sign-in IDs are issued by {{provider}} to each lender's staff." },
        "You can reach us at {{phone}} or {{email}}.",
      ],
    },
    {
      heading: "2. Information we collect",
      list: [
        { only: "customer", text: "Your name, mobile number, address and KYC details (such as Aadhaar or PAN numbers and documents) that your lender holds about you; your loan, interest and payment records; and the one-time password sent to your mobile number to sign you in." },
        { only: "staff", text: "About you: your name, login ID and role." },
        { only: "staff", text: "Customer information you enter while working (such as name, address, KYC or ID details, photographs and documents captured with the camera or chosen from your photo library). This belongs to the lender and its customers. We do not collect it for our own use: the app only passes it to the lender's account so you can verify the customer. We do not use it for any other purpose." },
        "Our servers log your IP address and the requests the app makes, used only to keep the service secure and working. The app has no push-notification, analytics, advertising or crash-reporting service.",
        "We do not collect your location, contacts or microphone data, and we do not use advertising identifiers.",
      ],
    },
    {
      heading: "3. How we use it",
      list: [
        "To sign you in and verify your identity.",
        { only: "customer", text: "To show and manage loans, payments and statements." },
        { only: "customer", text: "To meet legal, KYC and anti-money-laundering duties." },
        { only: "staff", text: "To let you record and verify customer details for the lender you work for. We use this data for that verification only." },
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
      body: ["We do not sell your personal data."],
      list: [
        { only: "customer", text: "We share it only with the lender (business) that holds your account;" },
        { only: "staff", text: "Customer details you enter are stored in the lender's account and are visible only to that lender's authorised users. Your staff details are shared only with that lender." },
        "Our hosting and message-delivery providers process data on our behalf under confidentiality.",
        { only: "customer", text: "We share payment data with Razorpay, our payment processor, when you pay a loan instalment: card, UPI or bank details are entered on Razorpay's screen and are processed by Razorpay under its own privacy policy; we do not receive or store them, and only receive the payment status, amount and reference;" },
        "We disclose data to authorities only when the law requires it.",
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
        { only: "customer", text: "We retain personal information for as long as necessary to provide the service, maintain your account and meet applicable legal, regulatory, accounting and record-keeping obligations. Certain loan, payment and KYC records may need to be kept after account deletion and are then restricted to compliance use. When information is no longer required, we delete or anonymise it, subject to applicable law." },
        { only: "staff", text: "We keep your staff login details while your account is active. Customer information you enter is held in the lender's account for the lender's own records and legal obligations; we do not keep it for any purpose of our own. When your login is disabled we delete or anonymise your staff profile, subject to applicable law." },
      ],
    },
    {
      heading: "8. Your rights",
      body: [
        { only: "customer", text: "You may ask to access or correct your data, to withdraw consent, or to have your data deleted, subject to the legal retention above." },
        { only: "staff", text: "You may ask to access or correct your staff details, or to have your login disabled and your staff profile deleted. Requests about a customer's information should go to the lender that holds it." },
        { only: "customer", text: "Account deletion: to request deletion, follow the steps on the Account Deletion page or call {{phone}}. We verify your identity and tell you the expected processing time; the Account Deletion page lists what is deleted and which records we must keep. Uninstalling the app does not delete your account." },
        { only: "staff", text: "Account deletion: because the app does not support user-initiated account creation, accounts are provisioned internally by administrators and cannot be created within the app. Staff members who wish to disable their login or request data deletion may contact their employer's administrator, call {{phone}} or write to {{email}}. We verify the request before acting. Uninstalling the app does not delete your account." },
      ],
    },
    { heading: "9. Children", body: ["The app is not for anyone under 18."] },
    { heading: "10. Changes", body: ["When this policy changes we update this page and its date."] },
    {
      heading: "11. Grievance contact",
      body: ["{{provider}}, {{address}}. Phone {{phone}}. Email {{email}}."],
    },
  ],
};
