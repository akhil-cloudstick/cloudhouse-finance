import { apiFetchEnveloped as apiFetch, ApiError, quietly } from "@/common/services/httpClient";
import { newEntry, offlineReady, upsertLocal, enqueueAndWait, type LocalRecord } from "@/common/offline";
import { currentActor } from "@/common/offline/actor";
import { queueWrite } from "@/common/offline/queueWrite";
import { investorOverlayKey } from "@/common/offline/investorAdjust";
import { offlineStore } from "@/common/services/desktopBridge";
import { buildOptimisticCustomer, UUID_ID } from "@/modules/customers/services/customerOffline";
import { toView, toRequestBody } from "@/modules/customers/services/customerService";
import { listInvestmentsForCustomer } from "@/modules/investments/services/investmentService";
import type { BackendCustomer, CustomerView, CustomerFormInput } from "@/modules/customers/types/customer-types";

/* Investors are their own records (backend table `investors`), separate from customers, so the same person can
 * be a borrower and an investor with the same phone / PAN / Aadhaar. The endpoints answer in the same shape as
 * a customer, so the customer view type is reused.
 *
 * On the desktop with offline mode running a create, edit or delete goes into the outbox and shows at once (see
 * common/offline/investorAdjust.ts for how it is laid over the list). An investor made here can be used for a new
 * investment straight away, before the server has numbered them. */

const INVESTOR_PICKER_PAGE_SIZE = 5;

/* One page (1-based) of investors, searched on the server by name / code / phone. */
export async function listInvestorsPage(
  q: string,
  page: number,
  filters?: { branchIds?: string[] },
  limit = 10
): Promise<{ items: CustomerView[]; hasMore: boolean; total: number }> {
  const params = new URLSearchParams({ q, limit: String(limit), offset: String((page - 1) * limit) });
  if (filters?.branchIds?.length) params.set("branchIds", filters.branchIds.join(","));
  const rec = await apiFetch<{ items: BackendCustomer[]; hasMore: boolean; total?: number }>(`/investors?${params}`);
  return { items: (rec?.items || []).map(toView), hasMore: !!rec?.hasMore, total: rec?.total ?? 0 };
}

/* 0-based page, for SearchableSelect pickers (New Investment's investor field). */
export async function searchInvestorsPage(q: string, page: number): Promise<{ items: CustomerView[]; hasMore: boolean }> {
  const params = new URLSearchParams({ q, limit: String(INVESTOR_PICKER_PAGE_SIZE), offset: String(page * INVESTOR_PICKER_PAGE_SIZE) });
  const rec = await apiFetch<{ items: BackendCustomer[]; hasMore: boolean }>(`/investors?${params}`);
  return { items: (rec?.items || []).map(toView), hasMore: !!rec?.hasMore };
}

export async function getInvestor(id: string): Promise<CustomerView> {
  return toView(await apiFetch<BackendCustomer>(`/investors/${id}`));
}

/* The decrypted Aadhaar number, to prefill the edit form. */
export async function getInvestorAadhaarFull(id: string): Promise<string> {
  const res = await apiFetch<{ aadhaar: string }>(`/investors/${id}/aadhaar-full`);
  return res.aadhaar;
}

/* `fromCustomerId` makes an existing customer an investor: the server carries over the Aadhaar number it holds. */
/* An existing investor already on file with the same phone number, PAN or Aadhaar under a different name — what the
 * server answers a new investor with (409, code "same_identity_different_name") until the user confirms. */
export type SameIdentityMatch = { id: number; source: "investor" | "customer"; code: string; name: string; phone: string; fields: string[] };

/* The matches in a "same person?" 409, or null when `e` is some other error. */
export function sameIdentityMatches(e: unknown): SameIdentityMatch[] | null {
  const d = (e as { status?: number; data?: { code?: string; matches?: SameIdentityMatch[] } } | null);
  return d?.status === 409 && d.data?.code === "same_identity_different_name" && Array.isArray(d.data.matches) ? d.data.matches : null;
}

/* ---- offline ------------------------------------------------------------------------------------------------------- */

const bad = (m: string, status = 400): never => {
  throw new ApiError(m, status);
};

/* The server's own field checks for an investor, run on this PC so a refusal comes before anything is saved. */
function checkInvestorFields(input: CustomerFormInput): void {
  const phone = (input.phone ?? "").trim();
  const pan = (input.pan ?? "").trim().toUpperCase();
  const aadhaar = (input.aadhaar ?? "").replace(/[\s-]/g, "");
  const acct = (input.bankAccountNumber ?? "").trim();
  if (!(input.name ?? "").trim()) bad("name is required");
  if (!phone) bad("phone is required");
  if (!/^\d{10}$/.test(phone)) bad("phone must be a 10-digit number");
  if (!input.branchId) bad("branch is required");
  if (!pan || !/^[A-Z]{5}\d{4}[A-Z]$/.test(pan)) bad("PAN must look like ABCDE1234F");
  if (aadhaar && !/^\d{12}$/.test(aadhaar)) bad("Aadhaar must be exactly 12 digits");
  if (!(input.bankAccountName ?? "").trim() || !acct || !(input.bankIfsc ?? "").trim()) bad("bank account name, number and IFSC are required");
  if (acct && (acct.length > 18 || /\D/.test(acct))) bad("bank account number must be digits only, up to 18 digits");
}

/* Every investor this PC knows (the server's last list, with the ones made here laid over it). An empty list when none is kept. */
async function knownInvestors(): Promise<BackendCustomer[]> {
  try {
    const rec = await quietly(() => apiFetch<{ items?: BackendCustomer[] }>(`/investors?limit=100000&offset=0`));
    return rec?.items ?? [];
  } catch {
    return [];
  }
}

/* The server refuses a phone number or PAN already on another investor; the same check is made here on what this PC holds, so
 * the person is told before saving rather than after the entry reaches the server. */
function checkNotTaken(input: CustomerFormInput, others: BackendCustomer[]): void {
  const phone = (input.phone ?? "").trim();
  const pan = (input.pan ?? "").trim().toUpperCase();
  const phoneHit = phone ? others.find((c) => (c.phone ?? "").trim() === phone) : undefined;
  if (phoneHit) bad(`phone number is already registered to another investor (${phoneHit.name}). If this is the same person, add them once you are online.`, 409);
  const panHit = pan ? others.find((c) => (c.pan ?? "").trim().toUpperCase() === pan) : undefined;
  if (panHit) bad(`PAN is already registered to another investor (${panHit.name}). If this is the same person, add them once you are online.`, 409);
}

const notSynced = () => bad("This investor has not reached the server yet. Try again once it has synced.", 409);

/* confirmSamePerson: the user has confirmed this investor is the same person as the existing one(s) that share
 * a phone number, PAN or Aadhaar under another name. */
export async function createInvestor(input: CustomerFormInput, fromCustomerId?: string, confirmSamePerson?: boolean, hint?: { branchName?: string }): Promise<CustomerView> {
  if (offlineReady() && !fromCustomerId) {
    checkInvestorFields(input);
    checkNotTaken(input, await knownInvestors());
    // the full Aadhaar is not on this PC for investors the server has; one waiting to be sent is compared whole
    const aadhaar = (input.aadhaar ?? "").replace(/[\s-]/g, "");
    if (aadhaar) {
      for (const line of await offlineStore.readAllOutbox().catch(() => [] as string[])) {
        try {
          const e = JSON.parse(line) as { method?: string; path?: string; body?: { aadhaar?: string } };
          if (e.method === "POST" && e.path === "/investors" && (e.body?.aadhaar ?? "").replace(/[\s-]/g, "") === aadhaar) {
            bad("Aadhaar number is already registered to another investor", 409);
          }
        } catch (err) {
          if (err instanceof ApiError) throw err;
        }
      }
    }
    const entry = newEntry("POST", "/investors", toRequestBody(input), currentActor());
    entry.targets = [entry.id];
    const draft = { ...buildOptimisticCustomer(entry.id, { ...input, customerType: "Investor" }, hint), kind: "new" };
    await enqueueAndWait(entry, () => upsertLocal("investors", draft as unknown as LocalRecord));
    return toView(draft as unknown as BackendCustomer);
  }
  if (offlineReady() && fromCustomerId) bad("Making an existing customer an investor needs a connection to the server.", 409);
  const q = new URLSearchParams();
  if (fromCustomerId) q.set("from_customer_id", fromCustomerId);
  if (confirmSamePerson) q.set("confirm_same_person", "true");
  const rec = await apiFetch<BackendCustomer>(`/investors${q.size ? `?${q}` : ""}`, { method: "POST", body: JSON.stringify(toRequestBody(input)) });
  return toView(rec);
}

export async function updateInvestor(id: string, input: CustomerFormInput, hint?: { branchName?: string }): Promise<CustomerView> {
  const path = `/investors/${id}`;
  const online = async () => toView(await apiFetch<BackendCustomer>(path, { method: "PUT", body: JSON.stringify(toRequestBody(input)) }));
  if (!offlineReady()) return online();
  if (id.startsWith(UUID_ID)) notSynced();
  const current = await getInvestor(id);
  checkInvestorFields({ ...input, aadhaar: input.aadhaar ?? "" });
  const others = (await knownInvestors()).filter((c) => String(c.id) !== id);
  const phone = (input.phone ?? "").trim();
  const pan = (input.pan ?? "").trim().toUpperCase();
  // only what was changed can clash: the investor's own phone and PAN are already theirs
  checkNotTaken({ ...input, phone: phone === (current.phone ?? "").trim() ? "" : phone, pan: pan === (current.pan ?? "").trim().toUpperCase() ? "" : pan }, others);
  const aadhaar = (input.aadhaar ?? "").replace(/\D/g, "");
  const changed = {
    name: input.name,
    phone: input.phone,
    address: input.address,
    branchId: input.branchId,
    ...(input.branchId !== current.branchId || hint?.branchName ? { branch: { id: input.branchId, name: hint?.branchName ?? current.branchName } } : {}),
    pan: input.pan,
    // the server keeps the old Aadhaar when none is sent, and shows the last four of the new one when it is
    aadhaarLast4: aadhaar ? aadhaar.slice(-4) : current.aadhaarLast4,
    bankAccountName: input.bankAccountName,
    bankAccountNumber: input.bankAccountNumber,
    bankIfsc: input.bankIfsc,
    updatedAt: new Date().toISOString(),
  };
  await queueWrite("PUT", path, toRequestBody(input), undefined, async () => void (await online()), async () => {
    await upsertLocal("investors", { uuid: investorOverlayKey(id), kind: "edit", id: Number(id), ...changed } as unknown as LocalRecord);
  });
  return { ...current, ...changed, branchName: hint?.branchName ?? current.branchName } as CustomerView;
}

/* Permanently deletes an investor. Refused (thrown, 409) while any investment is still on file; the message
 * names each one. */
export async function hardDeleteInvestor(id: string): Promise<void> {
  const path = `/investors/${id}/hard-delete`;
  const online = () => apiFetch<void>(path, { method: "DELETE" });
  if (!offlineReady()) {
    await online();
    return;
  }
  if (id.startsWith(UUID_ID)) notSynced();
  // the server refuses while an investment is on file; what this PC holds (those waiting to be sent too) is compared here
  const held = await listInvestmentsForCustomer(id).catch(() => []);
  if (held.length) bad(`Cannot delete this investor — it still has: ${held.map((i) => `Investment ${i.investmentNumber} (${i.status})`).join("; ")}. Close or delete these first.`, 409);
  await queueWrite("DELETE", path, undefined, undefined, online, async () => {
    await upsertLocal("investors", { uuid: investorOverlayKey(id), kind: "delete", id: Number(id) } as unknown as LocalRecord);
  });
}
