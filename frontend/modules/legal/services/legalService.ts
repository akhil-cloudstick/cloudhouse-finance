/* The "App Provider" block on every store-listing page.
 *
 * Static on purpose. These pages are read by app-store reviewers with no
 * session, and they must always name the company that publishes the app —
 * CloudHouse Technologies Pvt. Ltd., the software vendor — never a lender's
 * business (the old lookup asked the backend for the "default" business, whose
 * name and logo could be any lender's). Nothing here needs the backend, so the
 * pages also keep working if it is down.
 *
 * PROVIDER is read synchronously, so a legal page renders at once with no
 * "Loading…" step between pages. fetchProvider stays for older callers. */
import {
  APP_NAME,
  CONTACT_ADDRESS_LINES,
  CONTACT_EMAIL,
  CONTACT_LEGAL_NAME,
  CONTACT_PHONE_DISPLAY,
  CONTACT_WEBSITE,
} from "@/modules/legal/content/legalConfig";
import type { Provider } from "@/modules/legal/types/legal-types";
import markImg from "@/modules/legal/assets/cloudhouse-app-logo.png";

export const PROVIDER: Provider = {
  name: APP_NAME,
  legalName: CONTACT_LEGAL_NAME,
  addressLine: CONTACT_ADDRESS_LINES.join(" "),
  contactPhone: CONTACT_PHONE_DISPLAY,
  supportEmail: CONTACT_EMAIL,
  website: CONTACT_WEBSITE,
  logoUrl: markImg.src,
};

export async function fetchProvider(): Promise<Provider | null> {
  return PROVIDER;
}
