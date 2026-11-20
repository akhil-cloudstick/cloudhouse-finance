import { SplitPaymentInput, type SplitPayment } from "@/common/components/SplitPaymentInput";
import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { usePathname } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AccBtn,
  BtnRow2,
  C,
  Card,
  CheckItem,
  DateField,
  Field,
  FieldGrid,
  FieldRow,
  Input,

  PrimaryButton,
  ReviewWarning,
  SectionTitle,
  SheetListItem,
  TextField,
  Txt,
  WarningBanner,
  ZERO_SPLIT,
  isBalanced,
  type SplitAmounts,
  SheetFooter,
  ThemeDropdown,
  Stepper,
  ConfirmSheet,
  toast,
  openPage,
} from "@/common/components/ui";
import { inr, roundRupee, todayISO } from "@/common/utils/format";
import { approverItems } from "@/modules/loans/utils/approverItems";
import { useAuth } from "@/common/providers/AuthProvider";
import { useCanOpen } from "@/common/config/routePermissions";
import { verifyReleaseChecklist, recordReleasePayment, approveReleaseRequest, editReleaseRecord, deleteReleaseRecord } from "@/modules/loans/services/loanService";
import { isFinalStage, stageByPending, stageTag, stageIndex, canActAtStage, stepperSteps, useApprovalWorkflow } from "@/common/services/approvalWorkflowService";
import { listPackets, movePacket } from "@/modules/packets/services/packetService";
import { printReleaseAgreementPdf, printPartialReleaseReceiptPdf, RELEASE_AGREEMENT_LANGS, DOC_LANG_LABELS, type DocLang } from "@/modules/loans/utils/loanPrint";
import { LoanRequest, Loan } from "@/modules/loans/types/loan-types";
import { ApiError } from "@/common/services/httpClient";

// What a discount is given against — same options and labels as web's DISCOUNT_KIND_LABELS.
type DiscountKind = "customer" | "interest" | "penal_interest";
const DISCOUNT_KINDS: DiscountKind[] = ["customer", "interest", "penal_interest"];
const DISCOUNT_KIND_LABELS: Record<DiscountKind, string> = { customer: "Custom discount", interest: "Interest", penal_interest: "Penal interest" };

// Mirrors backend partialReleaseDrift: what the remaining collateral can't
// cover at the scheme LTV. ApproveReleaseRequest refuses a partial release
// with drift > 0.01 (ErrDriftPaymentRequired); the backend stays the authority.
function partialReleaseDrift(outstanding: number, remainingGoldValue: number, ltvPercent: number) {
  return outstanding - (remainingGoldValue * ltvPercent) / 100;
}

type ReleaseReviewPanelProps = { request: LoanRequest; loan: Loan; onSaved: () => void; onError: (message: string) => void };

/* Review for one Pending Release request, mirroring frontend/common/
 * components/modals/ReleaseReviewModal.tsx: "customer has seen the gold",
 * Record Payment (with a mode split), and the Manager → Management approval.
 * Final approval completes the release server-side (full: closes the loan;
 * partial: hands back only the selected ornaments). Drawn as the prototype's
 * #release-review-modal body. Used by the loan detail screen's release sheet
 * and the Requests list sheet — props API unchanged. */
export function ReleaseReviewPanel({ request, loan, onSaved, onError }: ReleaseReviewPanelProps) {
  const pathname = usePathname();
  // The Bank Pledge action this would link to is already on this very
  // screen when the panel is embedded in the loan detail page — so that
  // link is only shown from elsewhere (the Requests screen).
  const onThisLoanPage = pathname === `/loans/${loan.id}`;
  const { can, employee } = useAuth();
  const canDecide = can("Loan_Management", "can_update_loan");
  const canVerifyChecklist = can("Release_Approval", "can_verify_release_checklist");
  const canEditLedger = can("Loan_Management", "can_edit_ledger_entry");
  const canDeleteLedger = can("Loan_Management", "can_delete_ledger_entry");
  const canOpen = useCanOpen();
  // The "Go to …" shortcuts below only when the user may open where they lead.
  const canGoBankPledge = canOpen("/loans") && can("Bank_Pledge_Management", "can_view_bank_pledge_module");
  const canGoPackets = canOpen("/packets");
  // Tenant-configured "loan_release" chain. An empty approvalStage is the
  // PendingManager position (it doubles as "awaiting payment"), which the
  // request can sit on even when the Manager stage is switched off.
  const wf = useApprovalWorkflow();
  const pendingValue = request.approvalStage || "PendingManager";
  const stageDef = stageByPending(wf, "loan_release", pendingValue);
  const stage = stageDef?.key ?? "Manager";
  const stageLabel = stageDef?.label ?? "Manager";
  const isFinal = isFinalStage(wf, "loan_release", pendingValue);
  const steps = stepperSteps(wf, "loan_release", pendingValue);
  const canActOnStage = !!stageDef && canActAtStage(employee, stageDef);
  // RecordReleasePayment is refused past the Manager stage.
  const canRecordPayment = request.approvalStage === "" || request.approvalStage === "PendingManager";
  const isPending = request.status === "Pending";

  const [notes, setNotes] = useState(request.verificationNotes || "");
  const [discount, setDiscount] = useState("");
  // What the discount is given against, as on web: a custom discount, or the interest / penal interest owed.
  const [discountKind, setDiscountKind] = useState<DiscountKind>("customer");
  const canDiscount = can("Loan_Management", "can_give_discount");
  // The day of the release payment — staff can backdate it to the day the customer saw the gold.
  const [releaseDate, setReleaseDate] = useState(todayISO());
  // The amount follows what is owed after the discount until staff type their own figure — then it is left alone
  // (web's amountTyped rule). amountInput only holds what was typed.
  const [amountInput, setAmountInput] = useState("");
  const [amountTyped, setAmountTyped] = useState(false);
  const [pay, setPay] = useState<SplitPayment | null>(null);
  // Language being fetched ("partial" for the partial-release receipt).
  // One document row; the language options only open once it is tapped, like the bond.
  const [pickingLang, setPickingLang] = useState(false);
  const [downloading, setDownloading] = useState<DocLang | `partial-${DocLang}` | null>(null);
  // Seed editable fields only when a different request arrives, so a
  // background refetch never stomps on what staff is typing.
  const [seenId, setSeenId] = useState(request.id);
  useEffect(() => {
    if (request.id !== seenId) {
      setNotes(request.verificationNotes || "");
      setDiscount("");
      setDiscountKind("customer");
      setAmountInput("");
      setAmountTyped(false);
      setSeenId(request.id);
    }
  }, [request, seenId]);

  // Gold can't be shown to the customer while it's pledged to a bank or in a locker.
  const packet = useQuery({
    queryKey: ["packets", "forLoan", loan.id],
    queryFn: () => listPackets({ loanId: loan.id }),
    enabled: isPending,
  });
  const packetRecord = packet.data?.[0];
  const packetStatus = packetRecord?.status;
  // Only the ornaments of THIS request count; a pledge with no ornament list covers the whole loan.
  const releasingIds = request.isPartial
    ? (request.ornamentSelections ?? []).map((x) => x.ornamentId)
    : (loan.ornaments ?? []).filter((o) => !o.releasedAt).map((o) => o.id);
  const bankPledged = !!loan.bankPledges?.some(
    (p) => p.status === "Active" && (!p.ornamentIds || p.ornamentIds.length === 0 || p.ornamentIds.some((id) => releasingIds.includes(id))),
  );
  const inLocker = !bankPledged && packetStatus === "Locker Stored";
  // A locker packet is checked out automatically when the customer is marked as having seen the gold.
  const canMovePackets = can("Packet_Management", "can_update_packet");
  const packetAutoReleasable = inLocker && canMovePackets;
  const goldStillHeld = bankPledged || inLocker;
  const goldHeldReason = bankPledged ? "pledged to a bank" : "checked into a locker";

  const outstanding = loan.totalOutstandingBalance ?? loan.outstandingAmount;
  const ltv = loan.schemeLtvPercent ?? loan.scheme?.ltvPercent ?? 0;
  const selectedIds = new Set((request.ornamentSelections ?? []).map((s) => s.ornamentId));
  const pledged = (loan.ornaments ?? []).filter((o) => !o.releasedAt);
  const selectedOrnaments = pledged.filter((o) => selectedIds.has(o.id));
  // A full release covers every still-pledged ornament.
  const shownOrnaments = request.isPartial ? selectedOrnaments : pledged;
  const remainingGoldValue = request.isPartial ? pledged.filter((o) => !selectedIds.has(o.id)).reduce((s, o) => s + o.goldValue, 0) : 0;
  const drift = request.isPartial ? partialReleaseDrift(outstanding, remainingGoldValue, ltv) : 0;

  // What still has to come in for the release condition: the whole balance
  // for a full release, only the drift for a partial one.
  // Whole rupees, like web — the amount to collect is never a paise figure.
  const required = roundRupee(request.isPartial ? Math.max(0, drift) : outstanding);
  // Nothing to collect → no discount to give (web disables the field the same way).
  const discountBlocked = required <= 0;
  const discountAmt = canDiscount && !discountBlocked && +discount > 0 ? +discount : 0;
  // Choosing what the discount is for fills it with what is still owed of it; a custom discount is typed.
  function chooseDiscountKind(k: DiscountKind) {
    setDiscountKind(k);
    const v = k === "interest" ? roundRupee(loan.outstandingInterest ?? 0) : k === "penal_interest" ? roundRupee(loan.outstandingPenalInterest ?? 0) : 0;
    setDiscount(v > 0 ? String(v) : "");
  }
  // What the customer pays after the discount; the Amount shows this until they type their own figure.
  const modeTotal = Math.max(0, roundRupee(required - discountAmt));
  const amount = amountTyped ? amountInput : modeTotal > 0 ? String(modeTotal) : "";
  const paymentConditionMet = !!request.paymentRecorded || (request.isPartial ? drift <= 0.01 : outstanding <= 0.01);
  // Blocked outright while the gold is at a bank or in a locker — it has to
  // come back (bank pledge released / packet checked out) first.
  const canApprove = !goldStillHeld && !!request.customerSawGold && paymentConditionMet;

  function reportError(err: unknown) {
    onError(err instanceof ApiError ? err.message : "Something went wrong — try again.");
  }

  // A partial release gets the backend's partial-release receipt; a full
  // release gets the FORM 7 agreement — both in the chosen language.
  async function downloadReleaseAgreement(lang: DocLang, partial = false) {
    if (downloading) return;
    setDownloading(partial ? `partial-${lang}` : lang);
    try {
      if (partial) await printPartialReleaseReceiptPdf(request.id, lang);
      else await printReleaseAgreementPdf(loan.id, loan.loanNumber, lang);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Could not download the Release Agreement — try again.");
    } finally {
      setDownloading(null);
    }
  }

  // Optimistic: the tick shows on tap instead of after the save + refetch round trip; reverts if the save fails.
  const [sawGold, setSawGold] = useState(!!request.customerSawGold);
  useEffect(() => { setSawGold(!!request.customerSawGold); }, [request.customerSawGold]);
  const saveVerification = useMutation({
    mutationFn: (input: Parameters<typeof verifyReleaseChecklist>[1]) => verifyReleaseChecklist(request.id, input),
    onSuccess: onSaved,
    onError: (err) => { setSawGold(!!request.customerSawGold); reportError(err); },
  });

  const amt = +amount || 0;
  const split = pay?.split ?? { ...ZERO_SPLIT, cashAmount: amt };
  const splitOk = amt <= 0 || !!pay?.ready;

  const savePayment = useMutation({
    mutationFn: () =>
      recordReleasePayment(request.id, {
        amount: amt,
        discount: discountAmt,
        // Same as web: the reason is fixed, a discount moves no money so it is shown as Cash, and the type says what it is against.
        ...(discountAmt > 0 ? { discountReason: "Discount", discountMode: "Cash", discountKind } : {}),
        paidOn: releaseDate,
        ...(amt > 0 ? split : ZERO_SPLIT),
        bankId: amt > 0 ? pay?.bankId : undefined,
      }),
    onSuccess: () => {
      setDiscount("");
      setDiscountKind("customer");
      // Clear the amount and keep it "typed" so it does not re-prefill from the
      // pre-refetch (stale) balance — a second tap could collect the same money again.
      setAmountInput("");
      setAmountTyped(true);
      onSaved();
    },
    onError: reportError,
  });

  // Reject goes through a themed confirm (with the reason) first.
  const [confirmReject, setConfirmReject] = useState(false);
  // The release record's own date (edit) and the record itself (delete) — shown once a payment is recorded or the request is decided.
  const [recordDate, setRecordDate] = useState((request.requestedAt || todayISO()).slice(0, 10));
  useEffect(() => { setRecordDate((request.requestedAt || todayISO()).slice(0, 10)); }, [request.id, request.requestedAt]);
  const [confirmDeleteRecord, setConfirmDeleteRecord] = useState(false);
  const recordEditable = !!request.requestedAt && (request.status !== "Pending" || !!request.paymentRecorded);
  const saveRecordDate = useMutation({
    mutationFn: () => editReleaseRecord(request.id, { requestedAt: recordDate }),
    onSuccess: () => { toast.success("Release date updated"); onSaved(); },
    onError: reportError,
  });
  const removeRecord = useMutation({
    mutationFn: () => deleteReleaseRecord(request.id),
    onSuccess: () => { setConfirmDeleteRecord(false); toast.success("Release record deleted"); onSaved(); },
    onError: (err) => { setConfirmDeleteRecord(false); reportError(err); },
  });
  const decide = useMutation({
    mutationFn: ({ action, note }: { action: "Approved" | "Rejected"; note?: string }) =>
      approveReleaseRequest(request.id, {
        stage,
        action,
        remarks: note?.trim() || undefined,
      }),
    onSuccess: (_d, v) => {
      setConfirmReject(false);
      toast.success(v.action === "Rejected" ? "Release request rejected" : "Release approved");
      onSaved();
    },
    onError: (err) => {
      setConfirmReject(false);
      if (err instanceof ApiError && err.status === 409 && /drift|top-up/i.test(err.rawMessage)) {
        onError("The balance has grown past what the remaining gold covers — collect the shortfall through Payment Reception, then approve again.");
      } else reportError(err);
    },
  });

  const releasePacket = useMutation({
    mutationFn: (id: number) => movePacket(id, { toStatus: "Released", employeeId: 1, remarks: `Released with release request on ${loan.loanNumber}` }),
    onSuccess: () => { packet.refetch(); onSaved(); },
    onError: reportError,
  });

  const sawGoldDisabled = saveVerification.isPending || releasePacket.isPending || !canDecide || !canVerifyChecklist || !isPending || !!request.locked || !canRecordPayment || (goldStillHeld && !packetAutoReleasable);

  return (
    <View>
      {request.status === "Approved" ? (
        <View style={{ marginBottom: 10 }}>
          <SheetListItem
            first
            icon="doc"
            title={request.isPartial ? "Partial Release Receipt" : "Release Agreement"}
            sub={pickingLang ? "Choose the language below" : request.isPartial ? "Download the partial-release receipt" : "Gold handed back to the customer"}
            onPress={() => setPickingLang((v) => !v)}
          />
          {pickingLang
            ? RELEASE_AGREEMENT_LANGS.map((lang) => (
                <SheetListItem
                  key={lang}
                  icon="doc"
                  title={DOC_LANG_LABELS[lang]}
                  sub={downloading === (request.isPartial ? `partial-${lang}` : lang) ? "Preparing…" : `Download in ${DOC_LANG_LABELS[lang]}`}
                  onPress={() => downloadReleaseAgreement(lang, !!request.isPartial)}
                />
              ))
            : null}
        </View>
      ) : null}

      <FieldGrid
        style={{ marginBottom: 14 }}
        items={[
          { k: "Outstanding principal", v: inr(roundRupee(loan.outstandingAmount)) },
          { k: "Outstanding interest", v: inr(roundRupee(loan.outstandingInterest ?? 0)) },
          { k: "Penal interest", v: inr(roundRupee(loan.outstandingPenalInterest ?? 0)) },
          {
            k: request.isPartial ? "Required to release" : "Final settlement",
            v: inr(required),
            color: C.brandDeep,
          },
        ]}
      />

      {approverItems(request.approvals, (s) => stageTag(wf, "loan_release", s)).length ? <FieldGrid style={{ marginBottom: 14 }} items={approverItems(request.approvals, (s) => stageTag(wf, "loan_release", s))} /> : null}

      <SectionTitle flush style={{ marginTop: 0 }}>
        {request.isPartial ? `Ornaments in this request · ${selectedOrnaments.length} of ${pledged.length || selectedIds.size}` : "Ornaments in this request"}
      </SectionTitle>
      {shownOrnaments.length === 0 ? (
        <Txt style={{ fontSize: 12, color: C.muted, marginBottom: 14 }}>No ornaments still pledged.</Txt>
      ) : (
        shownOrnaments.map((o) => (
          <Card key={o.id} style={{ marginHorizontal: 0, marginTop: 0, marginBottom: 10 }}>
            <FieldGrid
              items={[
                { k: "Ornament", v: o.name },
                { k: "Purity", v: o.purity },
                { k: "Net weight", v: `${o.netWeight.toFixed(2)} g` },
                { k: "Gold value", v: inr(o.goldValue) },
              ]}
            />
          </Card>
        ))
      )}

      <TextField
        label="Verification notes"
        maxLength={150}
        placeholder="Notes from physical verification"
        value={notes}
        onChangeText={setNotes}
        onBlur={() => {
          if (notes !== (request.verificationNotes || "")) saveVerification.mutate({ verificationNotes: notes });
        }}
        editable={canDecide && canVerifyChecklist && isPending && !request.locked}
      />

      <View style={sawGoldDisabled ? { opacity: 0.6 } : null}>
        <CheckItem
          variant="confirm"
          checked={sawGold}
          onPress={() => {
            if (sawGoldDisabled) return;
            const next = !sawGold;
            if (next && packetAutoReleasable && packetRecord) {
              releasePacket.mutate(packetRecord.id, { onSuccess: () => { setSawGold(true); saveVerification.mutate({ customerSawGold: true }); } });
              return;
            }
            setSawGold(next);
            saveVerification.mutate({ customerSawGold: next });
          }}
          title="Customer has seen the gold"
          sub="Required before this request can be approved"
        />
      </View>
      {goldStillHeld && !packetAutoReleasable && isPending ? (
        <View style={{ marginBottom: 6 }}>
          <WarningBanner>
            Release is blocked — this loan&apos;s gold is still {goldHeldReason}. {bankPledged ? "Release the bank pledge first." : "Check the packet out of the locker first."}
          </WarningBanner>
          {bankPledged ? (
            onThisLoanPage ? (
              <Txt style={{ fontSize: 12, color: C.muted, marginBottom: 14 }}>Use Loan Actions → Bank Pledge on this page.</Txt>
            ) : !canGoBankPledge ? null : (
              <AccBtn label="Go to Bank Pledge" onPress={() => openPage(`/loans/${loan.id}?action=bank`)} style={{ marginBottom: 14 }} />
            )
          ) : !canGoPackets ? null : (
            <AccBtn
              label={packetRecord ? `Go to Packet ${packetRecord.code}` : "Go to Lockers"}
              onPress={() => (packetRecord ? openPage(`/packets/${packetRecord.id}`) : openPage("/packets?tab=lockers"))}
              style={{ marginBottom: 14 }}
            />
          )}
        </View>
      ) : null}

      {recordEditable && (canEditLedger || canDeleteLedger) ? (
        <View style={{ marginBottom: 10 }}>
          <DateField label="Release date" value={recordDate} onChange={setRecordDate} min={loan.openedDate?.slice(0, 10) || undefined} max={todayISO()} />
          <BtnRow2>
            {canDeleteLedger ? <PrimaryButton label="Delete Record" variant="outline" onPress={() => setConfirmDeleteRecord(true)} disabled={removeRecord.isPending} /> : null}
            {canEditLedger ? <PrimaryButton label="Save Date" onPress={() => saveRecordDate.mutate()} loading={saveRecordDate.isPending} disabled={recordDate === (request.requestedAt || "").slice(0, 10)} /> : null}
          </BtnRow2>
          <ConfirmSheet visible={confirmDeleteRecord} onClose={() => setConfirmDeleteRecord(false)} title="Delete Release Record" danger message="Delete this release record? The money it took is edited as ordinary loan payments and is not removed here." confirmLabel="Delete Record" loading={removeRecord.isPending} onConfirm={() => removeRecord.mutate()} />
        </View>
      ) : null}

      <SectionTitle flush style={{ marginTop: 0 }}>
        Payment — collect balance to settle this release
      </SectionTitle>
      {request.recordedDiscount + request.recordedPayment > 0 ? (
        <Txt style={{ fontSize: 12, color: C.muted, marginBottom: 10 }}>
          Already recorded: {inr(request.recordedDiscount)} discount + {inr(request.recordedPayment)} payment.
        </Txt>
      ) : null}
      {canDecide && canRecordPayment && isPending ? (
        <View style={{ marginBottom: 6 }}>
          <FieldRow>
            {canDiscount ? (
              <Field label="Discount Type">
                <ThemeDropdown value={discountKind} options={DISCOUNT_KINDS} labelOf={(k) => DISCOUNT_KIND_LABELS[k]} onChange={chooseDiscountKind} />
              </Field>
            ) : null}
            {canDiscount ? (
              <Field label="Discount (₹)">
                <Input
                  keyboardType="numeric"
                  placeholder={discountKind === "penal_interest" ? "Penal Interest" : discountKind === "interest" ? "Interest" : "Discount"}
                  editable={!discountBlocked}
                  value={discountBlocked ? "" : discount}
                  onChangeText={setDiscount}
                />
              </Field>
            ) : null}
          </FieldRow>
          <FieldRow>
            <Field label="Amount (₹)">
              <Input
                keyboardType="numeric"
                value={amount}
                onChangeText={(v) => { setAmountTyped(true); setAmountInput(v); }}
                onBlur={() => {
                  // Rupees only, like web: a typed amount with paise is rounded to the nearest rupee.
                  const n = +amount;
                  if (amount.trim() && Number.isFinite(n) && n > 0 && n !== roundRupee(n)) {
                    setAmountTyped(true);
                    setAmountInput(String(roundRupee(n)));
                    toast.success(`Amount rounded off to ${inr(roundRupee(n))}`);
                  }
                }}
              />
            </Field>
          </FieldRow>
          <DateField label="Release / payment date" value={releaseDate} onChange={setReleaseDate} max={todayISO()} />
          {amt > 0 ? <SplitPaymentInput total={amt} onChange={setPay} bankLabel="Bank (account it was received in)" /> : null}
          <AccBtn
            label={savePayment.isPending ? "Recording…" : request.paymentRecorded ? "Record Additional Payment" : "Record Payment"}
            primary
            onPress={() => {
              // The same checks, in the same order and wording, as web's payment form.
              if (!(amt > 0)) { onError("Please enter a valid payment amount."); return; }
              if (amt + discountAmt < required - 0.005) { onError(`${inr(Math.max(0, required - discountAmt))} amount needed to release gold`); return; }
              if (canDiscount && !discountBlocked && +discount < 0) { onError("Discount cannot be negative."); return; }
              if (discountAmt > required + 0.005) { onError(`Discount cannot exceed ${inr(required)}, the amount needed to release the gold.`); return; }
              savePayment.mutate();
            }}
            disabled={savePayment.isPending || !splitOk}
            style={{ marginBottom: 14 }}
          />
        </View>
      ) : !request.paymentRecorded && isPending ? (
        <Txt style={{ fontSize: 12, color: C.muted, marginBottom: 14 }}>Payment is recorded at the Manager stage.</Txt>
      ) : null}

      {isPending && steps.length ? <Stepper steps={steps} current={Math.max(0, stageIndex(wf, "loan_release", pendingValue))} /> : null}

      {!isPending ? null : !canApprove ? (
        <ReviewWarning>
          {goldStillHeld && !packetAutoReleasable
            ? `Blocked until the gold is no longer ${goldHeldReason}.`
            : !request.customerSawGold && !paymentConditionMet
              ? "Confirm the customer has seen the gold and record the payment before approving."
              : !request.customerSawGold
                ? "Confirm the customer has seen the gold before approving."
                : "Record the payment before approving."}
        </ReviewWarning>
      ) : (
        <Txt style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>
          Awaiting {stageLabel} approval.
          {isFinal ? " Final approval releases the gold." : ""}
        </Txt>
      )}

      {isPending && canActOnStage && canDecide ? (
        <>
          <SheetFooter>
            <BtnRow2>
              {!request.locked ? (
                <PrimaryButton
                  label="Reject"
                  variant="reject"
                  onPress={() => setConfirmReject(true)}
                  disabled={decide.isPending}
                />
              ) : null}
              <PrimaryButton
                label="Approve"
                onPress={() => decide.mutate({ action: "Approved" })}
                loading={decide.isPending && decide.variables?.action === "Approved"}
                disabled={!canApprove || decide.isPending}
              />
            </BtnRow2>
          </SheetFooter>
          <ConfirmSheet
            visible={confirmReject}
            onClose={() => setConfirmReject(false)}
            title="Reject Release"
            danger
            message="Reject this release request? The gold stays pledged and the loan stays open."
            remarks={{ label: "Reason (optional)", placeholder: "Why is this request being rejected?" }}
            confirmLabel="Reject Request"
            loading={decide.isPending && decide.variables?.action === "Rejected"}
            onConfirm={(note) => decide.mutate({ action: "Rejected", note })}
          />
        </>
      ) : null}
    </View>
  );
}
