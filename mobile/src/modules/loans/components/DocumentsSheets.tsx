import React, { useEffect, useState } from "react";
import { Linking, Pressable, View } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Buffering, C, Field, FieldGrid, NoticeBanner, PIcon, PrimaryButton, SectionTitle, Sheet, SheetListItem, Txt } from "@/common/components/ui";
import { checkIndemnityBondEsign, startIndemnityBondEsign } from "@/modules/loans/services/loanService";
import { type BondDeliverBy, type BondLang, type Loan } from "@/modules/loans/types/loan-types";
import {
  printLabelAndSlipOnePage,
  printPacketLabel,
  printPledgeSlip,
  printPledgeAgreementPdf,
  printReleaseAgreementPdf,
  printStatement,
  pledgeAgreementLangs,
  RELEASE_AGREEMENT_LANGS,
  DOC_LANG_LABELS,
  type DocLang,
} from "@/modules/loans/utils/loanPrint";
import { apiErr, invalidateLoan } from "@/common/components/loanSheetKit";
import { ErrorText } from "@/common/components/ErrorText";
import { useAuth } from "@/common/providers/AuthProvider";

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
  const [error, setError] = useState<string | null>(null);
  const [bondOpen, setBondOpen] = useState(false);
  const [releaseOpen, setReleaseOpen] = useState(false);
  const [esignOpen, setEsignOpen] = useState(false);
  const [esignLang, setEsignLang] = useState<BondLang>("en");
  // Step 2 of the Bond flow: which action the language is being picked for.
  const [langFor, setLangFor] = useState<BondAction | null>(null);
  const bondLangs = pledgeAgreementLangs();
  const [notice, setNotice] = useState<string | null>(null);
  const { can } = useAuth();
  const canSendEsign = can("Loan_Management", "can_update_loan");
  const canExport = can("Ledger_Export", "can_export_ledger");

  // Each opening starts clean — a failure from an earlier print shouldn't
  // greet the next visit to this sheet.
  useEffect(() => {
    if (visible) setError(null);
  }, [visible]);

  async function run(key: string, fn: () => Promise<unknown>, fail: string) {
    if (busy) return;
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      // Backing out of the system print dialog rejects printAsync with
      // "Printing did not complete" — that's the user's choice, not an error.
      const msg = e instanceof Error ? e.message : String(e ?? "");
      if (!/did not complete|cancel/i.test(msg)) setError(apiErr(e, fail));
    } finally {
      setBusy(null);
    }
  }

  const st = l.indemnityBondSignStatus;
  const signed = st === "sign_complete" && !!l.indemnityBondSignedUrl;
  const status = esignStatusText(l);

  // deliverBy: open the link here, or send it to the customer's WhatsApp / dashboard.
  const start = useMutation({
    mutationFn: (deliverBy: BondDeliverBy) => startIndemnityBondEsign(l.id, esignLang, "cloudhouse://esign-callback", deliverBy),
    onSuccess: (started, deliverBy) => {
      setEsignOpen(false);
      if (deliverBy === "open" && started.url) {
        Linking.openURL(started.url).catch(() => setError("Could not open the Aadhaar eSign link."));
        setNotice(null);
      } else if (deliverBy === "whatsapp") setNotice("Sent via WhatsApp to the customer's phone on file.");
      else setNotice("Sent to the customer's dashboard — they'll see it next time they open the app.");
      // Status / notice live in the Bond sheet — reopen it so the result is visible.
      setBondOpen(true);
      invalidateLoan(qc, l.id);
    },
    onError: (e) => setError(apiErr(e)),
  });

  const check = useMutation({
    mutationFn: () => checkIndemnityBondEsign(l.id),
    onSuccess: (r) => {
      setNotice(r.status === "sign_complete" ? "Signed successfully." : r.status === "failed" ? "Aadhaar eSign failed — send it again." : "Still waiting on the customer to complete Aadhaar eSign.");
      invalidateLoan(qc, l.id);
    },
    onError: (e) => setError(apiErr(e)),
  });

  const sub = (key: string, text: string) => (busy === key ? "Preparing…" : text);
  const openEsign = (lang: BondLang) => {
    setError(null);
    setEsignLang(lang);
    setLangFor(null);
    setBondOpen(false);
    setEsignOpen(true);
  };
  const printBond = (lang: DocLang) => run(`pledge-${lang}`, () => printPledgeAgreementPdf(l.id, l.loanNumber, lang), "Could not print the Pledge Agreement — try again.");
  // One language: nothing to choose, run straight away.
  const chooseAction = (action: BondAction) => {
    setError(null);
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
        {canExport ? (
          <SheetListItem icon="note" title="Statement" sub={sub("statement", "Statement of account for this loan")} onPress={() => run("statement", () => printStatement(l), "Could not print the statement — try again.")} />
        ) : null}
        <SheetListItem
          icon="doc"
          title="Bond"
          sub={signed ? "Pledge agreement · eSigned" : "Pledge agreement PDF and Aadhaar eSign"}
          onPress={() => {
            setError(null);
            onClose();
            setBondOpen(true);
          }}
        />
        {l.status === "Closed" ? (
          <SheetListItem
            icon="doc"
            title="Release Agreement"
            sub="Gold handed back to the customer"
            onPress={() => {
              setError(null);
              onClose();
              setReleaseOpen(true);
            }}
          />
        ) : null}
        {busy ? <Buffering /> : null}
        <ErrorText>{error}</ErrorText>
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
            onPress={() => Linking.openURL(l.indemnityBondSignedUrl!).catch(() => setError("Could not open the signed bond."))}
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
        <ErrorText>{error}</ErrorText>
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
        <ErrorText>{error}</ErrorText>
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
        <ErrorText>{error}</ErrorText>
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
        <ErrorText>{error}</ErrorText>
      </Sheet>
    </>
  );
}
