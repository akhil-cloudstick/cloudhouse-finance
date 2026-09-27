import React, { useEffect, useState } from "react";
import { Linking, View } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Buffering, C, ChipToggle, Field, FieldGrid, NoticeBanner, PrimaryButton, SectionTitle, Sheet, SheetListItem, Txt } from "../../ui";
import { checkIndemnityBondEsign, startIndemnityBondEsign, type BondDeliverBy, type BondLang } from "../../../api/loans";
import {
  printPledgeAgreementPdf,
  printReleaseAgreementPdf,
  printStatement,
  PLEDGE_AGREEMENT_LANGS,
  RELEASE_AGREEMENT_LANGS,
  DOC_LANG_LABELS,
  type DocLang,
} from "../../../utils/loanPrint";
import type { Loan } from "../../../types/loan";
import { ErrorText, apiErr, invalidateLoan } from "./common";

const BOND_LANGS = ["en", "ml", "gu"] as const;
const BOND_LANG_NAMES: Record<BondLang, string> = { en: "English", ml: "Malayalam", gu: "Gujarati" };

function esignStatusText(l: Loan) {
  const st = l.indemnityBondSignStatus;
  if (st === "sign_complete") return { text: "Signed", color: C.green };
  if (st === "sign_initiated") return { text: "Awaiting customer signature", color: C.amber };
  if (st === "failed") return { text: "Last attempt failed", color: C.red };
  return { text: "Not signed", color: C.amber };
}

/** Prototype #documents-modal plus #doc-agreement and #esign-modal. Every
 * print flow (statement, pledge /
 * release agreements) and the Aadhaar eSign of the indemnity bond. */
export function DocumentsSheets({ loan: l, visible, onClose, onOpen }: { loan: Loan; visible: boolean; onClose: () => void; onOpen: () => void }) {
  const qc = useQueryClient();
  const isFinished = l.status === "Closed" || l.status === "Rejected";
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bondOpen, setBondOpen] = useState(false);
  const [releaseOpen, setReleaseOpen] = useState(false);
  const [esignOpen, setEsignOpen] = useState(false);
  const [esignLang, setEsignLang] = useState<BondLang>("en");
  const [notice, setNotice] = useState<string | null>(null);

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
      // Status / notice live in the Documents sheet — reopen it so the result is visible.
      onOpen();
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
  const openEsign = () => {
    setError(null);
    onClose();
    setEsignOpen(true);
  };

  return (
    <>
      <Sheet visible={visible} onClose={onClose} title="Loan Documents">
        <SheetListItem first icon="note" title="Statement" sub={sub("statement", "Statement of account for this loan")} onPress={() => run("statement", () => printStatement(l), "Could not print the statement — try again.")} />
        <SheetListItem
          icon="doc"
          title="Indemnity Bond"
          sub="View / download the pledge agreement"
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
        {!isFinished ? (
          signed ? (
            <SheetListItem
              icon="shield"
              title="Signed Indemnity Bond"
              sub="Aadhaar eSign · signed — tap to open"
              onPress={() => Linking.openURL(l.indemnityBondSignedUrl!).catch(() => setError("Could not open the signed bond."))}
            />
          ) : st === "sign_initiated" ? (
            <>
              <SheetListItem
                icon="shield"
                title="Check eSign Status"
                sub={check.isPending ? "Checking…" : "Initiated — awaiting the customer's Aadhaar + OTP signature"}
                onPress={() => !check.isPending && check.mutate()}
              />
              <SheetListItem icon="edit" title="Send Bond for eSign Again" sub="Aadhaar eSign · resend the signing link" onPress={openEsign} />
            </>
          ) : (
            <SheetListItem
              icon="edit"
              title="Send Bond for eSign"
              sub={st === "failed" ? "Aadhaar eSign · last attempt failed — send again" : "Aadhaar eSign · not yet signed"}
              warn={st === "failed"}
              onPress={openEsign}
            />
          )
        ) : null}
        {busy || check.isPending ? <Buffering /> : null}
        {notice ? (
          <View style={{ marginTop: 8 }}>
            <NoticeBanner>{notice}</NoticeBanner>
          </View>
        ) : null}
        <ErrorText>{error}</ErrorText>
      </Sheet>

      <Sheet visible={bondOpen} onClose={() => setBondOpen(false)} title="Indemnity Bond">
        <FieldGrid
          style={{ marginTop: 8, marginBottom: 14 }}
          items={[
            { k: "Document", v: `pledge-agreement-${l.loanNumber}.pdf` },
            { k: "eSign status", v: status.text, color: status.color },
          ]}
        />
        {PLEDGE_AGREEMENT_LANGS.map((lang: DocLang) => (
          <PrimaryButton
            key={lang}
            label={PLEDGE_AGREEMENT_LANGS.length > 1 ? `Download PDF — ${DOC_LANG_LABELS[lang]}` : "Download PDF"}
            variant={lang === "en" ? "primary" : "outline"}
            style={{ marginBottom: 10 }}
            loading={busy === `pledge-${lang}`}
            disabled={!!busy && busy !== `pledge-${lang}`}
            onPress={() => run(`pledge-${lang}`, () => printPledgeAgreementPdf(l.id, l.loanNumber, lang), "Could not print the Pledge Agreement — try again.")}
          />
        ))}
        {signed ? (
          <PrimaryButton
            label="Open Signed Bond"
            variant="outline"
            onPress={() => Linking.openURL(l.indemnityBondSignedUrl!).catch(() => setError("Could not open the signed bond."))}
          />
        ) : null}
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
        <Field label="Bond language">
          <ChipToggle options={BOND_LANGS} value={esignLang} onChange={setEsignLang} labels={BOND_LANG_NAMES} wrap />
        </Field>
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
