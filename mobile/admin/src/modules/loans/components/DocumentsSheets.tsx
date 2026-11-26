import React, { useEffect, useState } from "react";
import { Linking, Pressable, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Buffering, C, Field, FieldGrid, NoticeBanner, PIcon, PrimaryButton, SectionTitle, Sheet, SheetListItem, Txt, toast } from "@/common/components/ui";
import { checkIndemnityBondEsign, checkPledgeSlipEsign, listLoanRequests, startIndemnityBondEsign, startPledgeSlipEsign } from "@/modules/loans/services/loanService";
import { type BondDeliverBy, type BondLang, type Loan } from "@/modules/loans/types/loan-types";
import {
  printLabelAndSlipOnePage,
  printPacketLabel,
  printPledgeSlip,
  printPledgeAgreementPdf,
  printReleaseAgreementPdf,
  printPartialReleaseReceiptPdf,
  printStatement,
  pledgeAgreementLangs,
  RELEASE_AGREEMENT_LANGS,
  DOC_LANG_LABELS,
  type DocLang,
} from "@/modules/loans/utils/loanPrint";
import { apiErr, invalidateLoan } from "@/common/components/loanSheetKit";
import { useAuth } from "@/common/providers/AuthProvider";
import { printPolicy } from "@/common/config/brand";

// Short mark shown in the language tile.
const LANG_MARKS: Record<DocLang, string> = { en: "EN", ta: "த", ml: "മ", gu: "ગ" };
type BondAction = "print" | "esign";

function esignStatusText(l: Loan) {
  const st = l.indemnityBondSignStatus;
  if (st === "sign_complete") return { text: "Signed", color: C.green };
  if (st === "sign_initiated") return { text: "Awaiting customer signature", color: C.amber };
  if (st === "failed") return { text: "Last attempt failed", color: C.red };
  return { text: "Not signed", color: C.amber };
}

type DocumentsSheetsProps = { loan: Loan; visible: boolean; onClose: () => void };

/** Prototype #documents-modal plus #doc-agreement and #esign-modal. Every
 * print flow (packet label, pledge slip, statement, pledge /
 * release agreements) and the Aadhaar eSign of the bond. */
export function DocumentsSheets({ loan: l, visible, onClose }: DocumentsSheetsProps) {
  const qc = useQueryClient();
  const isFinished = l.status === "Closed" || l.status === "Rejected";
  const [busy, setBusy] = useState<string | null>(null);
  const [bondOpen, setBondOpen] = useState(false);
  const [releaseOpen, setReleaseOpen] = useState(false);
  const [partialOpen, setPartialOpen] = useState(false);
  const [esignOpen, setEsignOpen] = useState(false);
  const [esignLang, setEsignLang] = useState<BondLang>("en");
  // Step 2 of the Bond flow: which action the language is being picked for.
  const [langFor, setLangFor] = useState<BondAction | null>(null);
  const bondLangs = pledgeAgreementLangs();
  const [notice, setNotice] = useState<string | null>(null);
  const { can } = useAuth();
  // Approved partial releases each have their own receipt (web: partialReleases in LoanDetailPage).
  const partialQ = useQuery({
    queryKey: ["loan-partial-releases", l.id, l.ornaments?.length],
    queryFn: () => listLoanRequests({ loanId: l.id, status: "Approved" }),
    enabled: visible,
  });
  const partialReleases = (partialQ.data ?? []).filter((r) => r.type === "Release" && r.isPartial);
  const canSendEsign = can("Loan_Management", "can_update_loan");
  const canExport = can("Ledger_Export", "can_export_ledger");

  // Each opening starts clean — a failure from an earlier print shouldn't
  // greet the next visit to this sheet.
  useEffect(() => {
      }, [visible]);

  async function run(key: string, fn: () => Promise<unknown>, fail: string) {
    if (busy) return;
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      // Backing out of the system print dialog rejects printAsync with
      // "Printing did not complete" — that's the user's choice, not an error.
      const msg = e instanceof Error ? e.message : String(e ?? "");
      if (!/did not complete|cancel/i.test(msg)) toast.error(apiErr(e, fail));
    } finally {
      setBusy(null);
    }
  }

  const st = l.indemnityBondSignStatus;
  const signed = st === "sign_complete" && !!l.indemnityBondSignedUrl;
  const status = esignStatusText(l);
  // Pledge slip eSign (GML only) — the customer is the only signer; delivery is WhatsApp or an in-person link.
  const [slipOpen, setSlipOpen] = useState(false);
  const [slipNotice, setSlipNotice] = useState<string | null>(null);
  const slipSt = l.pledgeSlipSignStatus ?? l.pledge_slip_sign_status;
  const slipSignedUrl = l.pledgeSlipSignedUrl ?? l.pledge_slip_signed_url;
  const slipSigned = slipSt === "sign_complete" && !!slipSignedUrl;
  const slipStatus = slipSt === "sign_complete" ? { text: "Signed", color: C.green } : slipSt === "sign_initiated" ? { text: "Awaiting customer signature", color: C.amber } : slipSt === "failed" ? { text: "Last attempt failed", color: C.red } : { text: "Not signed", color: C.amber };
  const isGml = printPolicy() === "gml";
  const slipStart = useMutation({
    mutationFn: (deliverBy: BondDeliverBy) => startPledgeSlipEsign(l.id, "cloudhouse://esign-callback", deliverBy),
    onSuccess: (started, deliverBy) => {
      if (deliverBy === "open" && started.url) {
        Linking.openURL(started.url).catch(() => toast.error("Could not open the Aadhaar eSign link."));
        setSlipNotice("eSign link is ready — complete it, then check the status here.");
      } else setSlipNotice("Pledge slip eSign link sent to the customer via WhatsApp.");
      invalidateLoan(qc, l.id);
    },
    onError: (e) => toast.error(apiErr(e)),
  });
  const slipCheck = useMutation({
    mutationFn: () => checkPledgeSlipEsign(l.id),
    onSuccess: (r) => {
      setSlipNotice(r.status === "sign_complete" ? "Pledge slip signed successfully." : r.status === "failed" ? "Aadhaar eSign failed — send it again." : "Still waiting on the customer to complete Aadhaar eSign.");
      invalidateLoan(qc, l.id);
    },
    onError: (e) => toast.error(apiErr(e)),
  });

  // deliverBy: open the link here, or send it to the customer's WhatsApp / dashboard.
  const start = useMutation({
    mutationFn: (deliverBy: BondDeliverBy) => startIndemnityBondEsign(l.id, esignLang, "cloudhouse://esign-callback", deliverBy),
    onSuccess: (started, deliverBy) => {
      setEsignOpen(false);
      if (deliverBy === "open" && started.url) {
        Linking.openURL(started.url).catch(() => toast.error("Could not open the Aadhaar eSign link."));
        setNotice(null);
      } else if (deliverBy === "whatsapp") setNotice("Sent via WhatsApp to the customer's phone on file.");
      else setNotice("Sent to the customer's dashboard — they'll see it next time they open the app.");
      // Status / notice live in the Bond sheet — reopen it so the result is visible.
      setBondOpen(true);
      invalidateLoan(qc, l.id);
    },
    onError: (e) => toast.error(apiErr(e)),
  });

  const check = useMutation({
    mutationFn: () => checkIndemnityBondEsign(l.id),
    onSuccess: (r) => {
      setNotice(r.status === "sign_complete" ? "Signed successfully." : r.status === "failed" ? "Aadhaar eSign failed — send it again." : "Still waiting on the customer to complete Aadhaar eSign.");
      invalidateLoan(qc, l.id);
    },
    onError: (e) => toast.error(apiErr(e)),
  });

  const sub = (key: string, text: string) => (busy === key ? "Preparing…" : text);
  const openEsign = (lang: BondLang) => {
    setEsignLang(lang);
    setLangFor(null);
    setBondOpen(false);
    setEsignOpen(true);
  };
  const printBond = (lang: DocLang) => run(`pledge-${lang}`, () => printPledgeAgreementPdf(l.id, l.loanNumber, lang), "Could not print the Pledge Agreement — try again.");
  // One language: nothing to choose, run straight away.
  const chooseAction = (action: BondAction) => {
    if (bondLangs.length === 1) {
      if (action === "print") printBond(bondLangs[0]);
      else openEsign(bondLangs[0]);
    } else setLangFor(action);
  };
  const pickLang = (lang: DocLang) => (langFor === "esign" ? openEsign(lang) : printBond(lang));
  const showSend = !isFinished && !signed && canSendEsign;

  return (
    <>
      <Sheet visible={visible} onClose={onClose} title="Loan Documents">
        {/* Same set and order as the web loan page's Documents menu: label and
            slip for everyone, the statement only with ledger export. */}
        <SheetListItem first icon="layers" title="Print Label" sub={sub("label", "Packet label with QR code")} onPress={() => run("label", () => printPacketLabel(l), "Could not print the label — try again.")} />
        <SheetListItem icon="doc" title="Print Slip" sub={sub("slip", "Pledge slip for the customer")} onPress={() => run("slip", () => printPledgeSlip(l), "Could not print the slip — try again.")} />
        <SheetListItem icon="doc" title="Print Slip + Label" sub={sub("slipLabel", "Both on one A4 page")} onPress={() => run("slipLabel", () => printLabelAndSlipOnePage(l), "Could not print the slip and label — try again.")} />
        {isGml && (slipSigned || (canSendEsign && !isFinished)) ? (
          <SheetListItem
            icon="doc"
            title="Pledge Slip eSign"
            sub={slipSigned ? "Pledge slip · eSigned" : slipSt === "sign_initiated" ? "Awaiting customer signature — check status" : "Send the slip for Aadhaar eSign"}
            onPress={() => {
              setSlipNotice(null);
              onClose();
              setSlipOpen(true);
            }}
          />
        ) : null}
        {canExport ? (
          <SheetListItem icon="note" title="Statement" sub={sub("statement", "Statement of account for this loan")} onPress={() => run("statement", () => printStatement(l), "Could not print the statement — try again.")} />
        ) : null}
        <SheetListItem
          icon="doc"
          title="Bond"
          sub={signed ? "Pledge agreement · eSigned" : "Pledge agreement PDF and Aadhaar eSign"}
          onPress={() => {
            onClose();
            setBondOpen(true);
          }}
        />
        {partialReleases.length > 0 ? (
          <SheetListItem
            icon="doc"
            title="Partial Release Receipt"
            sub={`${partialReleases.length} approved partial release${partialReleases.length > 1 ? "s" : ""}`}
            onPress={() => {
              onClose();
              setPartialOpen(true);
            }}
          />
        ) : null}
        {l.status === "Closed" ? (
          <SheetListItem
            icon="doc"
            title="Release Agreement"
            sub="Gold handed back to the customer"
            onPress={() => {
              onClose();
              setReleaseOpen(true);
            }}
          />
        ) : null}
        {busy ? <Buffering /> : null}
      </Sheet>

      <Sheet visible={slipOpen} onClose={() => setSlipOpen(false)} title="Pledge Slip eSign">
        <FieldGrid
          style={{ marginTop: 8, marginBottom: 14 }}
          items={[
            { k: "Loan", v: `${l.loanNumber} · ${l.customer?.name ?? `Customer #${l.customerId}`}` },
            { k: "eSign status", v: slipStatus.text, color: slipStatus.color },
          ]}
        />
        {slipSigned ? (
          <PrimaryButton label="Open Signed Slip" variant="outline" style={{ marginBottom: 10 }} onPress={() => Linking.openURL(slipSignedUrl!).catch(() => toast.error("Could not open the signed slip."))} />
        ) : (
          <>
            {slipStart.isPending ? (
              <Buffering block />
            ) : canSendEsign && !isFinished ? (
              <>
                <Txt style={{ fontSize: 11.5, color: C.muted, fontWeight: "600", marginBottom: 4 }}>Send signing link by</Txt>
                <SheetListItem first icon="card" title="WhatsApp" sub={`Send signing link to the customer's WhatsApp${l.customer?.phone ? ` (${l.customer.phone})` : ""}`} onPress={() => slipStart.mutate("whatsapp")} />
                <SheetListItem icon="share" title="Signing Link" sub="Open the link here, for in-person signing at the branch" onPress={() => slipStart.mutate("open")} />
              </>
            ) : null}
            {slipSt === "sign_initiated" ? (
              <PrimaryButton label={slipCheck.isPending ? "Checking…" : "Check eSign Status"} variant="outline" style={{ marginTop: 10, marginBottom: 10 }} loading={slipCheck.isPending} onPress={() => slipCheck.mutate()} />
            ) : null}
          </>
        )}
        <Txt style={{ fontSize: 11.5, color: C.muted, marginVertical: 8 }}>Only the customer signs, with their own Aadhaar OTP.</Txt>
        {slipNotice ? (
          <View style={{ marginTop: 4 }}>
            <NoticeBanner>{slipNotice}</NoticeBanner>
          </View>
        ) : null}
      </Sheet>

      <Sheet visible={bondOpen && !langFor} onClose={() => setBondOpen(false)} title="Bond">
        <FieldGrid
          style={{ marginTop: 8, marginBottom: 14 }}
          items={[
            { k: "Document", v: `pledge-agreement-${l.loanNumber}.pdf` },
            { k: "eSign status", v: status.text, color: status.color },
          ]}
        />
        <PrimaryButton label="Print Bond" style={{ marginBottom: 10 }} disabled={!!busy} onPress={() => chooseAction("print")} />
        {showSend ? (
          <PrimaryButton
            label={st === "sign_initiated" ? "Send for eSign Again" : st === "failed" ? "Send for eSign — retry" : "Send Bond for eSign"}
            variant="outline"
            style={{ marginBottom: 10 }}
            onPress={() => chooseAction("esign")}
          />
        ) : null}
        <Txt style={{ fontSize: 11.5, color: C.muted, marginBottom: 10 }}>
          Print opens the PDF to print or share. eSign sends the customer an Aadhaar OTP signing link.
        </Txt>
        {signed ? (
          <PrimaryButton
            label="Open Signed Bond"
            variant="outline"
            style={{ marginBottom: 10 }}
            onPress={() => Linking.openURL(l.indemnityBondSignedUrl!).catch(() => toast.error("Could not open the signed bond."))}
          />
        ) : null}
        {!isFinished && !signed && st === "sign_initiated" ? (
          <PrimaryButton
            label={check.isPending ? "Checking…" : "Check eSign Status"}
            variant="outline"
            style={{ marginBottom: 10 }}
            loading={check.isPending}
            onPress={() => check.mutate()}
          />
        ) : null}
        {notice ? (
          <View style={{ marginTop: 8 }}>
            <NoticeBanner>{notice}</NoticeBanner>
          </View>
        ) : null}
      </Sheet>

      <Sheet visible={bondOpen && !!langFor} onClose={() => setLangFor(null)} title={langFor === "esign" ? "Send Bond for eSign" : "Print Bond"}>
        <Pressable onPress={() => setLangFor(null)} hitSlop={8} style={{ flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 4, marginTop: 8 }}>
          <View style={{ transform: [{ rotate: "180deg" }] }}>
            <PIcon name="chevright" color={C.brandDeep} />
          </View>
          <Txt style={{ fontSize: 12.5, fontWeight: "700", color: C.brandDeep }}>Back</Txt>
        </Pressable>
        <Txt style={{ fontSize: 11.5, color: C.muted, fontWeight: "600", marginTop: 12, marginBottom: 4 }}>Choose the language</Txt>
        {bondLangs.map((lang: DocLang, i: number) => {
          const rowBusy = busy === `pledge-${lang}`;
          return (
            <Pressable
              key={lang}
              disabled={!!busy}
              onPress={() => pickLang(lang)}
              style={{ flexDirection: "row", alignItems: "center", gap: 13, paddingVertical: 14, paddingHorizontal: 2, borderTopWidth: i ? 1 : 0, borderTopColor: C.line, opacity: busy && !rowBusy ? 0.5 : 1 }}
            >
              <View style={{ width: 38, height: 38, borderRadius: 11, backgroundColor: C.brandFaint, alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Txt style={{ fontWeight: "800", fontSize: 13, color: C.brandDeep }}>{LANG_MARKS[lang]}</Txt>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Txt style={{ fontWeight: "700", fontSize: 13.5 }}>{DOC_LANG_LABELS[lang]}</Txt>
                <Txt style={{ fontSize: 11, color: C.muted, marginTop: 1 }}>
                  {rowBusy ? "Preparing…" : langFor === "esign" ? `Customer signs the ${DOC_LANG_LABELS[lang]} bond` : `Pledge agreement PDF in ${DOC_LANG_LABELS[lang]}`}
                </Txt>
              </View>
              {rowBusy ? <Buffering style={{ paddingVertical: 0 }} /> : <PIcon name="chevright" color={C.muted} />}
            </Pressable>
          );
        })}
      </Sheet>

      <Sheet visible={partialOpen} onClose={() => setPartialOpen(false)} title="Partial Release Receipt">
        {partialReleases.map((pr, i) => (
          <View key={pr.id}>
            <SectionTitle flush style={{ marginTop: 8 }}>
              {`Release ${i + 1}${pr.requestedAt ? ` · ${pr.requestedAt.slice(0, 10)}` : ""}`}
            </SectionTitle>
            {RELEASE_AGREEMENT_LANGS.map((lang: DocLang) => (
              <PrimaryButton
                key={lang}
                label={`Download PDF — ${DOC_LANG_LABELS[lang]}`}
                variant={lang === "en" ? "primary" : "outline"}
                style={{ marginBottom: 10 }}
                loading={busy === `partial-${pr.id}-${lang}`}
                disabled={!!busy && busy !== `partial-${pr.id}-${lang}`}
                onPress={() => run(`partial-${pr.id}-${lang}`, () => printPartialReleaseReceiptPdf(pr.id, lang), "Could not print the partial release receipt — try again.")}
              />
            ))}
          </View>
        ))}
      </Sheet>

      <Sheet visible={releaseOpen} onClose={() => setReleaseOpen(false)} title="Release Agreement">
        <SectionTitle flush style={{ marginTop: 8 }}>
          Gold handed back to the customer
        </SectionTitle>
        {RELEASE_AGREEMENT_LANGS.map((lang: DocLang) => (
          <PrimaryButton
            key={lang}
            label={`Download PDF — ${DOC_LANG_LABELS[lang]}`}
            variant={lang === "en" ? "primary" : "outline"}
            style={{ marginBottom: 10 }}
            loading={busy === `release-${lang}`}
            disabled={!!busy && busy !== `release-${lang}`}
            onPress={() => run(`release-${lang}`, () => printReleaseAgreementPdf(l.id, l.loanNumber, lang), "Could not print the Release Agreement — try again.")}
          />
        ))}
      </Sheet>

      <Sheet visible={esignOpen} onClose={() => setEsignOpen(false)} title="Send Bond for eSign">
        <Txt style={{ fontSize: 11.5, color: C.muted, fontWeight: "600", marginVertical: 8 }}>
          {l.loanNumber} · {l.customer?.name ?? `Customer #${l.customerId}`}
          {l.customer?.phone ? ` · ${l.customer.phone}` : ""}
        </Txt>
        <Field label={`Bond language: ${DOC_LANG_LABELS[esignLang]}`} />
        <Field label="How should the customer sign?" />
        {start.isPending ? (
          <Buffering block />
        ) : (
          <>
            <SheetListItem first icon="share" title="Open" sub="Opens the Aadhaar eSign link directly here" onPress={() => start.mutate("open")} />
            <SheetListItem icon="card" title="WhatsApp" sub="Sent via WhatsApp to the customer's phone on file" onPress={() => start.mutate("whatsapp")} />
            <SheetListItem icon="home" title="Dashboard" sub="Sent to the customer's dashboard" onPress={() => start.mutate("dashboard")} />
          </>
        )}
      </Sheet>
    </>
  );
}
