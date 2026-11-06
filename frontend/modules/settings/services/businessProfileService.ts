import { apiFetchEnveloped as apiFetch } from "@/common/services/httpClient";
import { offlineReady } from "@/common/offline";
import { queueWrite } from "@/common/offline/queueWrite";
import { refuse } from "@/common/offline/validate";
import type { BusinessProfile, BusinessProfileInput } from "@/modules/settings/types/settings-types";

export async function getBusinessProfile(): Promise<BusinessProfile> {
  return apiFetch<BusinessProfile>("/business-profile");
}

/* The server's own profile checks (business name, contact phone(s), support email, and under GML the lender's age, PAN and Aadhaar),
 * made before the change is queued. The business's policy is read from the profile this PC holds; when it is not known the lender
 * identity is left to the server. */
async function checkProfile(input: BusinessProfileInput): Promise<void> {
  for (const p of (input.contactPhone || "").split(",").map((x) => x.trim()).filter(Boolean)) {
    if (!/^\+?[0-9][0-9 ()-]{5,18}$/.test(p)) refuse("contact phone is not valid");
  }
  const email = (input.supportEmail || "").trim();
  if (email && (email.length > 160 || !/^[^@\s]+@[^@\s]+$/.test(email))) refuse("support email is not a valid email address");
  if (!(input.name || "").trim()) refuse("business name is required");
  let policy = "";
  try {
    policy = (await getBusinessProfile()).policy;
  } catch {
    return;
  }
  if (policy.toLowerCase() !== "gml") return;
  const age = Number((input.lenderAge || "").trim());
  if (!Number.isInteger(age) || age < 18 || age > 120) refuse("lender age is required for a GML business (18–120)");
  if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test((input.lenderPan || "").trim().toUpperCase())) refuse("lender PAN is required for a GML business, e.g. ABCDE1234F");
  if (!/^[0-9]{12}$/.test((input.lenderAadhaar || "").split(/\s+/).join(""))) refuse("lender Aadhaar is required for a GML business (12 digits)");
}

export async function updateBusinessProfile(input: BusinessProfileInput): Promise<BusinessProfile> {
  const online = () => apiFetch<BusinessProfile>("/business-profile", { method: "PUT", body: JSON.stringify(input) });
  if (!offlineReady()) return online();
  await checkProfile(input);
  // the screen shows the profile with this change applied, as the server would answer
  let current: Partial<BusinessProfile> = {};
  try {
    current = await getBusinessProfile();
  } catch {
    /* nothing kept yet */
  }
  return queueWrite("PUT", "/business-profile", input, { ...current, ...input } as BusinessProfile, online);
}
