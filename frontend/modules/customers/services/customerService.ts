import { apiFetchEnveloped as apiFetch, ApiError } from "@/common/services/httpClient";
import { enqueueAndWait, getLocal, listLocal, newEntry, offlineReady, removeLocal, upsertLocal, type LocalRecord } from "@/common/offline";
import { currentActor } from "@/common/offline/actor";
import { queueWrite } from "@/common/offline/queueWrite";
import { getSelectedBranchId } from "@/common/services/branchSelection";
import { offlineStore } from "@/common/services/desktopBridge";
import { buildOptimisticCustomer, UUID_ID } from "@/modules/customers/services/customerOffline";
import { uploadFile as uploadSharedFile } from "@/common/services/uploadService";
import { isSmallScreen } from "@/common/utils/responsive";
import { toView as toLoanView, toAuctionRecordView, toCustomerOrnamentRowView, toCustomerPaymentRowView, toCustomerBankPledgeRowView, toCustomerAuctionRowView } from "@/modules/loans/services/loanService";
import { type BackendLoan, type LoanView, type BackendCustomerOrnamentRow, type CustomerOrnamentRowView, type BackendCustomerPaymentRow, type CustomerPaymentRowView, type BackendCustomerBankPledgeRow, type CustomerBankPledgeRowView, type BackendCustomerAuctionRow, type CustomerAuctionRowView } from "@/modules/loans/types/loan-types";
import type { BackendCustomer, CustomerView, CustomerFormInput, PanVerificationResult, AadhaarVerificationStart, AadhaarVerificationCheck, Customer360View, BackendCustomer360 } from "@/modules/customers/types/customer-types";

export function toView(c: BackendCustomer): CustomerView {
  return {
    // a customer the server has not numbered yet is known by the id the PC gave them
    id: c.id ? String(c.id) : c.uuid ? UUID_ID + c.uuid : "",
    code: c.code,
    name: c.name,
    phone: c.phone,
    // "0001-01-01" is Go's zero time (DOB never entered) — treat as unset.
    dob: c.dob && !c.dob.startsWith("0001-") ? c.dob.slice(0, 10) : "",
    address: c.address,
    branchId: c.branchId,
    branchName: c.branch?.name || "—",
    photoUrl: c.photoUrl,
    identityProofUrl: c.identityProofUrl,
    addressProofUrl: c.addressProofUrl,
    kycDocumentUrl: c.kycDocumentUrl,
    pan: c.pan,
    aadhaarLast4: c.aadhaarLast4,
    nomineeName: c.nomineeName,
    nomineeRelation: c.nomineeRelation,
    nomineePhone: c.nomineePhone,
    kycStatus: c.kycStatus,
    panStatus: c.panStatus,
    aadhaarStatus: c.aadhaarStatus,
    fatherName: c.fatherName,
    district: c.district,
    taluk: c.taluk,
    village: c.village,
    place: c.place,
    pinCode: c.pinCode,
    age: c.age,
    customerType: c.customerType,
    bankAccountName: c.bankAccountName,
    bankAccountNumber: c.bankAccountNumber,
    bankIfsc: c.bankIfsc,
    loanCount: c.loanCount,
  };
}

/* Three-way verification label for display (e.g. the new-loan customer
 * picker) — deliberately checks panStatus/aadhaarStatus directly rather
 * than the derived kycStatus, since kycStatus collapses "one of two
 * passed" and "neither passed" into the same "Pending" value (see
 * backend/internal/customer/service.go's deriveKYCStatus), but the UI
 * needs to tell those two apart. */
export function verificationLabel(c: { panStatus: string; aadhaarStatus: string }): "Verified" | "Part Verified" | "Unverified" {
  const panOK = c.panStatus === "Verified";
  const aadhaarOK = c.aadhaarStatus === "Verified";
  if (panOK && aadhaarOK) return "Verified";
  if (panOK || aadhaarOK) return "Part Verified";
  return "Unverified";
}

export function toRequestBody(input: CustomerFormInput) {
  return {
    name: input.name,
    phone: input.phone,
    dob: input.dob || undefined,
    address: input.address,
    branchId: input.branchId,
    photoUrl: input.photoUrl,
    identityProofUrl: input.identityProofUrl,
    addressProofUrl: input.addressProofUrl,
    kycDocumentUrl: input.kycDocumentUrl,
    pan: input.pan,
    aadhaar: input.aadhaar,
    nomineeName: input.nomineeName,
    nomineeRelation: input.nomineeRelation,
    nomineePhone: input.nomineePhone,
    fatherName: input.fatherName || undefined,
    district: input.district || undefined,
    taluk: input.taluk || undefined,
    village: input.village || undefined,
    place: input.place || undefined,
    pinCode: input.pinCode || undefined,
    age: input.age,
    customerType: input.customerType || undefined,
    bankAccountName: input.bankAccountName || undefined,
    bankAccountNumber: input.bankAccountNumber || undefined,
    bankIfsc: input.bankIfsc || undefined,
  };
}

/* On the desktop, a read the server did not answer at all is answered from this PC's local copy (this
 * branch's customers). An answer from the server, even an error, is never replaced. */
async function orLocal<T>(live: () => Promise<T>, local: () => T): Promise<T> {
  try {
    return await live();
  } catch (e) {
    if (offlineReady() && e instanceof ApiError && e.status === 0) return local();
    throw e;
  }
}

function localCustomers(): BackendCustomer[] {
  // the branch picked in the switcher narrows an admin's local copy, as the X-Branch-Id header does live
  const picked = getSelectedBranchId();
  return (listLocal("customers") as unknown as BackendCustomer[])
    .filter((c) => !picked || c.branchId === picked)
    // the same order the server lists them in (oldest first, by id); a customer the server has not numbered yet follows, in the
    // order it was registered
    .sort((a, b) => {
      const ai = a.id > 0 ? a.id : Number.MAX_SAFE_INTEGER;
      const bi = b.id > 0 ? b.id : Number.MAX_SAFE_INTEGER;
      return ai - bi || (a.createdAt ?? "").localeCompare(b.createdAt ?? "");
    });
}

/* Customers registered on this PC that the server has not numbered yet, narrowed like the server would (search text, type). */
function unsentCustomers(q: string, type?: string): CustomerView[] {
  return localCustomers()
    .filter((c) => !(c.id > 0))
    .filter((c) => !type || (c.customerType ?? "Borrower") === type)
    .filter((c) => matchesCustomer(c, q))
    .map(toView);
}

function matchesCustomer(c: BackendCustomer, q: string): boolean {
  const needle = q.trim().toLowerCase();
  return !needle || [c.name, c.code, c.phone].join(" ").toLowerCase().includes(needle);
}

export async function listCustomers(): Promise<CustomerView[]> {
  return orLocal(
    async () => ((await apiFetch<BackendCustomer[]>("/customers")) || []).map(toView),
    () => localCustomers().map(toView),
  );
}

export const CUSTOMERS_TABLE_PAGE_SIZE = 10;

/* Paginated variant of listCustomers for the Customers page's own table
 * (distinct from CUSTOMER_PAGE_SIZE below, which backs the SearchableSelect
 * picker's infinite scroll) — CustomersProvider still fetches the full,
 * unpaginated list for consumers that need every customer at once (global
 * search, New Loan's picker), so this is a separate call rather than a
 * change to listCustomers/CustomersProvider. */
export async function listCustomersPage(
  q: string,
  page: number,
  filters?: { panStatus?: string; aadhaarStatus?: string; branchIds?: string[]; customerType?: string },
  limit?: number
): Promise<{ items: CustomerView[]; hasMore: boolean; total: number }> {
  const pageSize = limit ?? (isSmallScreen() ? 7 : 9);
  const params = new URLSearchParams({ q, limit: String(pageSize), offset: String((page - 1) * pageSize) });
  if (filters?.panStatus) params.set("panStatus", filters.panStatus);
  if (filters?.aadhaarStatus) params.set("aadhaarStatus", filters.aadhaarStatus);
  if (filters?.branchIds?.length) params.set("branchIds", filters.branchIds.join(","));
  if (filters?.customerType) params.set("customerType", filters.customerType);
  return orLocal(
    async () => {
      const rec = await apiFetch<{ items: BackendCustomer[]; hasMore: boolean; total?: number }>(`/customers?${params}`);
      // customers registered on this PC and not sent yet are not in the server's answer: they follow it on the first page
      const unsent = page === 1 ? unsentCustomers(q, filters?.customerType) : [];
      return { items: [...(rec?.items || []).map(toView), ...unsent], hasMore: !!rec?.hasMore, total: (rec?.total ?? 0) + unsent.length };
    },
    () => {
      const all = localCustomers()
        .filter((c) => matchesCustomer(c, q))
        .filter((c) => !filters?.panStatus || c.panStatus === filters.panStatus)
        .filter((c) => !filters?.aadhaarStatus || c.aadhaarStatus === filters.aadhaarStatus)
        .filter((c) => !filters?.branchIds?.length || filters.branchIds.includes(String(c.branchId)))
        .filter((c) => !filters?.customerType || (c.customerType ?? "Borrower") === filters.customerType);
      const from = (page - 1) * pageSize;
      return { items: all.slice(from, from + pageSize).map(toView), hasMore: from + pageSize < all.length, total: all.length };
    },
  );
}

/* Server-side search across name/code/phone — backs SearchableSelect
 * pickers (see NewLoan.tsx) instead of filtering the full listCustomers()
 * result client-side. */
export async function searchCustomers(q: string): Promise<CustomerView[]> {
  const rec = await apiFetch<BackendCustomer[]>(`/customers?q=${encodeURIComponent(q)}`);
  return (rec || []).map(toView);
}

const CUSTOMER_PAGE_SIZE = 5;

/* Paginated variant of searchCustomers — backs SearchableSelect's infinite
 * scroll (see SearchableSelect.tsx). `page` is 0-based; the backend
 * responds with an {items, hasMore} envelope whenever `limit` is passed
 * (see backend/internal/customer/handler.go's List). */
export async function searchCustomersPage(q: string, page: number, pageSize: number = CUSTOMER_PAGE_SIZE): Promise<{ items: CustomerView[]; hasMore: boolean }> {
  const params = new URLSearchParams({ q, limit: String(pageSize), offset: String(page * pageSize) });
  return orLocal(
    async () => {
      const rec = await apiFetch<{ items: BackendCustomer[]; hasMore: boolean }>(`/customers?${params}`);
      return { items: [...(rec?.items || []).map(toView), ...(page === 0 ? unsentCustomers(q) : [])], hasMore: !!rec?.hasMore };
    },
    () => {
      const all = localCustomers().filter((c) => c.customerType !== "Investor" && matchesCustomer(c, q));
      const from = page * CUSTOMER_PAGE_SIZE;
      return { items: all.slice(from, from + CUSTOMER_PAGE_SIZE).map(toView), hasMore: from + CUSTOMER_PAGE_SIZE < all.length };
    },
  );
}

/* Same as searchCustomersPage, narrowed to Borrower customers — investors are kept to the Investments section, so
 * loan pickers never offer them. */
export async function searchBorrowersPage(q: string, page: number): Promise<{ items: CustomerView[]; hasMore: boolean }> {
  const params = new URLSearchParams({ q, limit: String(CUSTOMER_PAGE_SIZE), offset: String(page * CUSTOMER_PAGE_SIZE), customerType: "Borrower" });
  return orLocal(
    async () => {
      const rec = await apiFetch<{ items: BackendCustomer[]; hasMore: boolean }>(`/customers?${params}`);
      return { items: [...(rec?.items || []).map(toView), ...(page === 0 ? unsentCustomers(q, "Borrower") : [])], hasMore: !!rec?.hasMore };
    },
    () => {
      // the borrowers on this PC, including one registered here that the server has not numbered yet
      const all = localCustomers().filter((c) => c.customerType !== "Investor" && matchesCustomer(c, q));
      const from = page * CUSTOMER_PAGE_SIZE;
      return { items: all.slice(from, from + CUSTOMER_PAGE_SIZE).map(toView), hasMore: from + CUSTOMER_PAGE_SIZE < all.length };
    },
  );
}

export async function getCustomer(id: string): Promise<CustomerView> {
  return orLocal(
    async () => toView(await apiFetch<BackendCustomer>(`/customers/${id}`)),
    () => {
      const rec = (listLocal("customers") as unknown as BackendCustomer[]).find((c) => (id.startsWith(UUID_ID) ? c.uuid === id.slice(UUID_ID.length) : String(c.id) === id));
      if (!rec) throw new ApiError("Customer not found", 404);
      return toView(rec);
    },
  );
}

/* A customer page's URL carries the customer's code (CUST-04), older links the
 * numeric id — both resolve here. */
export function isNumericCustomerRef(ref: string): boolean {
  return /^\d+$/.test(ref);
}

export async function getCustomerByRef(ref: string): Promise<CustomerView> {
  if (isNumericCustomerRef(ref)) return getCustomer(ref);
  return orLocal(
    async () => toView(await apiFetch<BackendCustomer>(`/customers/by-code/${encodeURIComponent(ref)}`)),
    () => {
      // the page is opened by the customer's code; with no server answer it is found in this PC's copy
      const rec = (listLocal("customers") as unknown as BackendCustomer[]).find((c) => c.code === ref);
      if (!rec) throw new ApiError("Customer not found", 404);
      return toView(rec);
    },
  );
}

/* A customer page's URL carries the customer's code (CUST-04), older links the
 * numeric id — both resolve here. */


export async function verifyCustomerPan(id: string): Promise<PanVerificationResult> {
  const res = await apiFetch<{ customer: BackendCustomer; message: string; matchedName: string; traceId: string }>(
    `/customers/${id}/verify-pan`,
    { method: "POST" }
  );
  return { customer: toView(res.customer), message: res.message, matchedName: res.matchedName, traceId: res.traceId };
}

/* Full, decrypted Aadhaar number (GET /customers/:id/aadhaar-full) — the
 * one endpoint that ever returns more than AadhaarLast4. Used solely to
 * prefill the printable pledge agreement (modules/loans/utils/
 * indemnityBond.ts); every other customer read stays last-4-only. */
export async function getCustomerAadhaarFull(id: string): Promise<string> {
  const res = await apiFetch<{ aadhaar: string }>(`/customers/${id}/aadhaar-full`);
  return res.aadhaar;
}

export async function startAadhaarVerify(customerId: string, redirectUrl: string): Promise<AadhaarVerificationStart> {
  return apiFetch<AadhaarVerificationStart>(`/customers/${customerId}/verify-aadhaar/start`, {
    method: "POST",
    body: JSON.stringify({ redirectUrl }),
  });
}

export async function checkAadhaarVerify(customerId: string): Promise<AadhaarVerificationCheck> {
  const res = await apiFetch<{ status: string; customer?: BackendCustomer; matchedName?: string; dob?: string; failureReasons?: string[] }>(
    `/customers/${customerId}/verify-aadhaar/check`,
    { method: "POST" }
  );
  return { status: res.status, customer: res.customer ? toView(res.customer) : undefined, matchedName: res.matchedName, dob: res.dob, failureReasons: res.failureReasons ?? [] };
}

/* The server's own field checks (customerValidate), run on this PC so a refusal comes before anything is saved. */
function checkCustomerFields(input: CustomerFormInput): void {
  const p = (input.phone ?? "").trim();
  const panIn = (input.pan ?? "").trim().toUpperCase();
  const aadhaarIn = (input.aadhaar ?? "").replace(/[\s-]/g, "");
  const bad = (m: string): never => {
    throw new ApiError(m, 400);
  };
  if (!(input.name ?? "").trim()) bad("name is required");
  if (!p) bad("phone is required");
  if (!/^\d{10}$/.test(p)) bad("phone must be a 10-digit number");
  if (!input.branchId) bad("branch is required");
  if (panIn && !/^[A-Z]{5}\d{4}[A-Z]$/.test(panIn)) bad("PAN must look like ABCDE1234F");
  if (aadhaarIn && !/^\d{12}$/.test(aadhaarIn)) bad("Aadhaar must be exactly 12 digits");
  if (/\d/.test(input.nomineeName ?? "")) bad("nominee name must not contain digits");
  if (/\d/.test(input.nomineeRelation ?? "")) bad("nominee relation must not contain digits");
  const acct = input.bankAccountNumber ?? "";
  if (acct && (acct.length > 18 || /\D/.test(acct))) bad("bank account number must be digits only, up to 18 digits");
  if (input.customerType && input.customerType !== "Borrower" && input.customerType !== "Investor") bad("customer type must be Borrower or Investor");
  if (input.customerType === "Investor") {
    if (!input.bankAccountName || !acct || !input.bankIfsc) bad("bank account name, number and IFSC are required");
    if (!panIn || !aadhaarIn) bad("PAN and Aadhaar are required for an investor");
  }
}

export async function createCustomer(input: CustomerFormInput, hint?: { branchName?: string }): Promise<CustomerView> {
  if (!offlineReady()) {
    const rec = await apiFetch<BackendCustomer>("/customers", {
      method: "POST",
      body: JSON.stringify(toRequestBody(input)),
    });
    return toView(rec);
  }
  // The server refuses a phone, PAN or Aadhaar already on file, and a refusal found only when the entry is sent leaves a
  // customer on this PC that never reaches the server (and every loan or investment made for them). The same check is
  // made here on this PC's copy, so the person is told before saving.
  // the server's own field checks (customerValidate), first
  checkCustomerFields(input);
  const known = listLocal("customers") as unknown as BackendCustomer[];
  const phone = (input.phone ?? "").trim();
  if (phone && known.some((c) => (c.phone ?? "").trim() === phone)) {
    throw new ApiError("phone number is already registered to another customer", 409);
  }
  // the server compares PANs in capitals; this PC holds every customer's PAN
  const pan = (input.pan ?? "").trim().toUpperCase();
  if (pan && known.some((c) => (c.pan ?? "").trim().toUpperCase() === pan)) {
    throw new ApiError("PAN is already registered to another customer", 409);
  }
  // This PC holds only the last four digits of a customer the server has, so the full number can be matched only against
  // customers made on this PC and still waiting to be sent (their entries carry it whole). A number the server already has
  // under another customer is refused when the entry is sent.
  const aadhaar = (input.aadhaar ?? "").replace(/[\s-]/g, "");
  if (aadhaar) {
    for (const line of await offlineStore.readAllOutbox().catch(() => [] as string[])) {
      try {
        const e = JSON.parse(line) as { method?: string; path?: string; body?: { aadhaar?: string } };
        if (e.method === "POST" && e.path === "/customers" && (e.body?.aadhaar ?? "").replace(/[\s-]/g, "") === aadhaar) {
          throw new ApiError("Aadhaar number is already registered to another customer", 409);
        }
      } catch (err) {
        if (err instanceof ApiError) throw err;
      }
    }
  }
  // Desktop: the save goes into the outbox first and the customer is in the local copy at once, so a loan can
  // be started for them straight away. If the server answers within a few seconds the real record comes back
  // (with its customer code), otherwise they show without a code until the next send.
  const entry = newEntry("POST", "/customers", toRequestBody(input), currentActor());
  entry.targets = [entry.id];
  const draft = buildOptimisticCustomer(entry.id, input, hint);
  await enqueueAndWait(
    entry,
    () => upsertLocal("customers", draft as unknown as LocalRecord),
    () => removeLocal("customers", entry.id),
  );
  // a customer merged into one already on file (the same phone, PAN or Aadhaar, entered on another PC) is the
  // existing record once the pull has run
  const saved = (getLocal("customers", entry.id) as unknown as BackendCustomer | undefined) ?? draft;
  return toView(saved);
}

export async function updateCustomer(id: string, input: CustomerFormInput): Promise<CustomerView> {
  const path = `/customers/${id}`;
  const online = async () => toView(await apiFetch<BackendCustomer>(path, { method: "PUT", body: JSON.stringify(toRequestBody(input)) }));
  if (!offlineReady()) return online();
  const current = localCustomerRecord(id);
  if (!current) throw new ApiError("Customer not found", 404);
  checkCustomerFields(input);
  // phone and PAN must stay unique, as the server enforces on an edit (the customer's own record is not a clash)
  const others = (listLocal("customers") as unknown as BackendCustomer[]).filter((c) => c.uuid !== current.uuid);
  const phone = (input.phone ?? "").trim();
  if (phone !== (current.phone ?? "").trim() && others.some((c) => (c.phone ?? "").trim() === phone)) {
    throw new ApiError("phone number is already registered to another customer", 409);
  }
  const pan = (input.pan ?? "").trim().toUpperCase();
  if (pan && pan !== (current.pan ?? "").trim().toUpperCase() && others.some((c) => (c.pan ?? "").trim().toUpperCase() === pan)) {
    throw new ApiError("PAN is already registered to another customer", 409);
  }
  // a customer made on this PC and not sent yet is addressed by the id this PC gave them
  const target = current.id ? path : `/customers/${UUID_ID}${current.uuid}`;
  const body = toRequestBody(input);
  const saved = (): BackendCustomer => {
    const aadhaar = (input.aadhaar ?? "").replace(/D/g, "");
    return {
      ...current,
      name: input.name,
      phone: input.phone,
      dob: input.dob ?? "",
      address: input.address,
      branchId: input.branchId,
      photoUrl: input.photoUrl,
      identityProofUrl: input.identityProofUrl,
      addressProofUrl: input.addressProofUrl,
      kycDocumentUrl: input.kycDocumentUrl,
      pan: input.pan,
      // the server keeps the old Aadhaar when none is sent, and shows the last four of the new one when it is
      aadhaarLast4: aadhaar ? aadhaar.slice(-4) : current.aadhaarLast4,
      nomineeName: input.nomineeName,
      nomineeRelation: input.nomineeRelation,
      nomineePhone: input.nomineePhone,
      fatherName: input.fatherName,
      district: input.district,
      taluk: input.taluk,
      village: input.village,
      place: input.place,
      pinCode: input.pinCode,
      age: input.age ?? current.age,
      customerType: input.customerType || current.customerType,
      bankAccountName: input.bankAccountName,
      bankAccountNumber: input.bankAccountNumber,
      bankIfsc: input.bankIfsc,
      updatedAt: new Date().toISOString(),
    } as BackendCustomer;
  };
  await queueWrite("PUT", target, body, undefined, async () => void (await online()), async () => {
    const next = saved();
    await upsertLocal("customers", next as unknown as LocalRecord);
    // loans on this PC carry the customer's name and phone for their lists
    for (const l of listLocal("loans") as unknown as BackendLoan[]) {
      const mine = current.id ? l.customerId === current.id : l.customerId === 0 && l.customer?.name === current.name;
      if (!mine || !l.customer) continue;
      await upsertLocal("loans", { ...l, customer: { ...l.customer, name: next.name, phone: next.phone } } as unknown as LocalRecord);
    }
  });
  return toView(saved());
}

export async function deleteCustomer(id: string): Promise<void> {
  const path = `/customers/${id}`;
  await queueWrite("DELETE", path, undefined, undefined, () => apiFetch<void>(path, { method: "DELETE" }));
}

/* Permanently deletes the customer and every record tied to them (loans and
 * everything under each one, device/OTP login records, notifications,
 * standalone reminders) — see backend/internal/customer/harddelete.go.
 * Rejected (thrown) if any of the customer's loans aren't yet Closed/
 * Auctioned; the thrown error's message names the offending loan number(s). */
export async function hardDeleteCustomer(id: string): Promise<void> {
  const path = `/customers/${id}/hard-delete`;
  if (offlineReady()) {
    const { customer, loans } = localCustomerWithLoans(id);
    // the server refuses while a gold loan is still open; the loans this PC holds are compared here, with its own words
    const blocking = loans.filter((l) => !["Closed", "Rejected", "Auctioned"].includes(String(l.status))).map((l) => `Gold loan ${l.loanNumber} (${l.status})`);
    if (blocking.length) throw new ApiError(`Cannot delete this customer — it still has: ${blocking.join("; ")}. Close or delete these first.`, 409);
    // a delete is for good, so the customer and the closed loans the server would delete with them leave this PC's copy at once
    await queueWrite("DELETE", path, undefined, undefined, () => apiFetch<void>(path, { method: "DELETE" }), async () => {
      if (customer) await removeLocal("customers", customer.uuid);
      for (const l of loans) await removeLocal("loans", l.uuid);
    });
    return;
  }
  await queueWrite("DELETE", path, undefined, undefined, () => apiFetch<void>(path, { method: "DELETE" }));
}

type LocalLoanRef = { uuid: string; loanNumber?: string; status?: string; customerId?: number };

/* The customer this PC holds under a number or a "uuid:..." reference, and the gold loans it holds for them. */
function localCustomerWithLoans(ref: string): { customer?: { uuid: string; id: number }; loans: LocalLoanRef[] } {
  const uuid = ref.replace(/^uuid:/, "");
  const customer = (listLocal("customers") as unknown as { uuid: string; id: number }[]).find((c) => c.uuid === uuid || String(c.id) === ref);
  if (!customer) return { loans: [] };
  const loans = (listLocal("loans") as unknown as LocalLoanRef[]).filter((l) => customer.id > 0 && l.customerId === customer.id);
  return { customer, loans };
}

/* `range` narrows the profile to loans opened within an inclusive
 * YYYY-MM-DD window — the filtering is done by the backend (which also
 * recomputes the totals over the narrowed set), so both bounds are passed
 * straight through as query params rather than filtered client-side. */
export async function getCustomer360(
  id: string,
  range?: { from?: string; to?: string }
): Promise<Customer360View> {
  const qs = new URLSearchParams();
  if (range?.from) qs.set("from", range.from);
  if (range?.to) qs.set("to", range.to);
  const suffix = qs.toString() ? `?${qs}` : "";
  return orLocal(() => getCustomer360Live(id, suffix), () => {
    const cust = localCustomerRecord(id);
    if (!cust) throw new ApiError("Customer not found", 404);
    const loans = localLoansOf(id, range);
    const closed = loans.filter((l) => l.status === "Closed");
    return {
      customer: toView(cust),
      loans: loans.map(toLoanView),
      auctionHistory: [],
      totalDisbursed: loans.reduce((s, l) => s + (l.disbursedAmount ?? 0), 0),
      totalOutstanding: loans.reduce((s, l) => s + (l.totalOutstandingBalance ?? l.outstandingAmount ?? 0), 0),
      totalPaid: loans.reduce((s, l) => s + (l.totalPaid ?? 0), 0),
      activeLoanCount: loans.filter((l) => l.status !== "Closed" && l.status !== "Rejected").length,
      closedLoanCount: closed.length,
    };
  });
}

async function getCustomer360Live(id: string, suffix: string): Promise<Customer360View> {
  const rec = await apiFetch<BackendCustomer360>(`/customers/${id}/profile360${suffix}`);
  return {
    customer: toView(rec.customer),
    loans: (rec.loans || []).map(toLoanView),
    auctionHistory: (rec.auctionHistory || []).map(toAuctionRecordView),
    totalDisbursed: rec.totalDisbursed,
    totalOutstanding: rec.totalOutstanding,
    totalPaid: rec.totalPaid,
    activeLoanCount: rec.activeLoanCount,
    closedLoanCount: rec.closedLoanCount,
  };
}

/* --- Customer 360 sub-table pagination ------------------------------------
 * The 5 sub-tables on CustomerDetail.tsx (Loan History, Pledged Ornaments,
 * Payment History, Bank Pledges, Auction History) used to be sliced
 * client-side out of getCustomer360's single big payload. They're now
 * fetched independently, one paginated call per page per table, following
 * this codebase's limit/offset + {items, hasMore} convention (see
 * loanService.ts's listLoansPage) — each backed by its own
 * GET /customers/:id/{loans,ornaments,payments,bank-pledges,
 * auction-history} endpoint (backend/internal/loan/handler.go). `range`
 * mirrors getCustomer360's from/to opened-date window. */
/* 9 rows — the height the 360 view's table card is sized for, so a full
 * page fills it exactly without the card growing. */
export const CUSTOMER_SUBTABLE_PAGE_SIZE = 10;

function subTableParams(page: number, range?: { from?: string; to?: string; search?: string }, limit?: number): URLSearchParams {
  const pageSize = limit ?? (isSmallScreen() ? 7 : 10);
  const params = new URLSearchParams({
    limit: String(pageSize),
    offset: String((page - 1) * pageSize),
  });
  if (range?.from) params.set("from", range.from);
  if (range?.to) params.set("to", range.to);
  if (range?.search) params.set("search", range.search);
  return params;
}

/* The customer details page, worked out from this PC's local copy for when the server does not answer: that
 * customer's loans and what hangs off them (ornaments, payments, bank pledges). Auction history is held only on
 * the server, so it is empty here. */
function localCustomerRecord(id: string): BackendCustomer | undefined {
  return (listLocal("customers") as unknown as BackendCustomer[]).find((c) => (id.startsWith(UUID_ID) ? c.uuid === id.slice(UUID_ID.length) : String(c.id) === id));
}

function localLoansOf(id: string, range?: { from?: string; to?: string }): BackendLoan[] {
  const cust = localCustomerRecord(id);
  if (!cust) return [];
  const all = listLocal("loans") as unknown as BackendLoan[];
  return all
    .filter((l) => (cust.id ? l.customerId === cust.id : l.customerId === 0 && l.customer?.name === cust.name))
    .filter((l) => (!range?.from || l.openedDate.slice(0, 10) >= range.from) && (!range?.to || l.openedDate.slice(0, 10) <= range.to))
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}

function pageOfLocal<T>(all: T[], page: number, limit?: number): { items: T[]; hasMore: boolean; total: number } {
  const size = limit ?? (isSmallScreen() ? 7 : 10);
  const from = (page - 1) * size;
  return { items: all.slice(from, from + size), hasMore: from + size < all.length, total: all.length };
}

export async function listCustomerLoansPage(
  customerId: string,
  page: number,
  range?: { from?: string; to?: string; search?: string },
  limit?: number
): Promise<{ items: LoanView[]; hasMore: boolean; total: number }> {
  const params = subTableParams(page, range, limit);
  return orLocal(
    async () => {
      const rec = await apiFetch<{ items: BackendLoan[]; hasMore: boolean; total?: number }>(`/customers/${customerId}/loans?${params}`);
      return { items: (rec?.items || []).map(toLoanView), hasMore: !!rec?.hasMore, total: rec?.total ?? 0 };
    },
    () => {
      const p = pageOfLocal(localLoansOf(customerId, range), page, limit);
      return { ...p, items: p.items.map(toLoanView) };
    },
  );
}

export async function listCustomerOrnamentsPage(
  customerId: string,
  page: number,
  range?: { from?: string; to?: string; search?: string },
  limit?: number
): Promise<{ items: CustomerOrnamentRowView[]; hasMore: boolean; total: number }> {
  const params = subTableParams(page, range, limit);
  return orLocal(
    async () => {
      const rec = await apiFetch<{ items: BackendCustomerOrnamentRow[]; hasMore: boolean; total?: number }>(`/customers/${customerId}/ornaments?${params}`);
      return { items: (rec?.items || []).map(toCustomerOrnamentRowView), hasMore: !!rec?.hasMore, total: rec?.total ?? 0 };
    },
    () => {
      const rows = localLoansOf(customerId, range).flatMap((l) => (l.ornaments ?? []).map((o) => ({ ...o, loanId: l.id, loanNumber: l.loanNumber })));
      const p = pageOfLocal(rows, page, limit);
      return { ...p, items: p.items.map(toCustomerOrnamentRowView) };
    },
  );
}

export async function listCustomerPaymentsPage(
  customerId: string,
  page: number,
  range?: { from?: string; to?: string; search?: string },
  limit?: number
): Promise<{ items: CustomerPaymentRowView[]; hasMore: boolean; total: number }> {
  const params = subTableParams(page, range, limit);
  return orLocal(
    async () => {
      const rec = await apiFetch<{ items: BackendCustomerPaymentRow[]; hasMore: boolean; total?: number }>(`/customers/${customerId}/payments?${params}`);
      return { items: (rec?.items || []).map(toCustomerPaymentRowView), hasMore: !!rec?.hasMore, total: rec?.total ?? 0 };
    },
    () => {
      const rows = localLoansOf(customerId, range)
        .flatMap((l) => (l.payments ?? []).map((p) => ({ ...p, loanId: l.id, loanNumber: l.loanNumber })))
        .sort((a, b) => (b.paidOn ?? "").localeCompare(a.paidOn ?? ""));
      const p = pageOfLocal(rows, page, limit);
      return { ...p, items: p.items.map(toCustomerPaymentRowView) };
    },
  );
}

export async function listCustomerBankPledgesPage(
  customerId: string,
  page: number,
  range?: { from?: string; to?: string; search?: string },
  limit?: number
): Promise<{ items: CustomerBankPledgeRowView[]; hasMore: boolean; total: number }> {
  const params = subTableParams(page, range, limit);
  return orLocal(
    async () => {
      const rec = await apiFetch<{ items: BackendCustomerBankPledgeRow[]; hasMore: boolean; total?: number }>(`/customers/${customerId}/bank-pledges?${params}`);
      return { items: (rec?.items || []).map(toCustomerBankPledgeRowView), hasMore: !!rec?.hasMore, total: rec?.total ?? 0 };
    },
    () => {
      const rows = localLoansOf(customerId, range).flatMap((l) => (l.bankPledges ?? []).map((b) => ({ ...b, loanId: l.id, loanNumber: l.loanNumber })));
      const p = pageOfLocal(rows, page, limit);
      return { ...p, items: p.items.map(toCustomerBankPledgeRowView) };
    },
  );
}

export async function listCustomerAuctionHistoryPage(
  customerId: string,
  page: number,
  range?: { from?: string; to?: string; search?: string },
  limit?: number
): Promise<{ items: CustomerAuctionRowView[]; hasMore: boolean; total: number }> {
  const params = subTableParams(page, range, limit);
  return orLocal(
    async () => {
      const rec = await apiFetch<{ items: BackendCustomerAuctionRow[]; hasMore: boolean; total?: number }>(`/customers/${customerId}/auction-history?${params}`);
      return { items: (rec?.items || []).map(toCustomerAuctionRowView), hasMore: !!rec?.hasMore, total: rec?.total ?? 0 };
    },
    () => ({ items: [], hasMore: false, total: 0 }),
  );
}

/* Uploads one file (photo/identity proof/address proof/KYC document) to the
 * shared upload endpoint (backend/internal/upload) and returns the URL to
 * store on the customer record. */
export async function uploadFile(file: File): Promise<string> {
  return uploadSharedFile(file);
}
