import React, { useEffect, useState } from "react";
import { View, ScrollView, Pressable, ActivityIndicator, StyleSheet, Alert } from "react-native";
import { File, Paths } from "expo-file-system";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { ScreenContainer } from "../../src/components/ScreenContainer";
import { Card } from "../../src/components/Card";
import { ThemedText } from "../../src/components/ThemedText";
import { FloatingHeader } from "../../src/components/FloatingHeader";
import { BottomSheetModal } from "../../src/components/BottomSheetModal";
import { NotificationList } from "../../src/components/NotificationList";
import { GoldButton } from "../../src/components/GoldButton";
import { Icon } from "../../src/components/Icon";
import { colors } from "../../src/theme/colors";
import { useAuth } from "../../src/auth/AuthContext";
import * as loansApi from "../../src/api/loans";
import { Loan } from "../../src/api/loans";
import * as documentsApi from "../../src/api/documents";

function money(n: number | undefined | null): string {
  return `₹${(n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

// Keeps the real file extension from a URL (e.g. ".jpg", ".pdf") so the
// downloaded local file opens correctly in whatever the customer's device
// hands it to — staff-uploaded KYC documents aren't guaranteed to be PDFs.
function extname(url: string): string {
  const match = /\.[a-zA-Z0-9]{2,4}(?:\?|$)/.exec(url);
  return match ? match[0].replace(/\?$/, "") : "";
}

type KYCDocRow = { key: string; label: string; icon: "doc"; url?: string };

// Documents tab per the Batch 5 plan: a per-loan statement PDF (loan picker
// + download, mirroring payments.tsx's "Pay a loan" picker and receipt
// download pattern) plus a read-only list of the customer's own
// staff-uploaded KYC documents — already present on the profile fetched by
// AuthContext since Batch 4, no separate fetch needed here.
export default function DocumentsScreen() {
  const { customer } = useAuth();
  const [notifOpen, setNotifOpen] = useState(false);

  const [loans, setLoans] = useState<Loan[]>([]);
  const [loansLoading, setLoansLoading] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedLoan, setSelectedLoan] = useState<Loan | null>(null);
  const [downloadingStatement, setDownloadingStatement] = useState(false);
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await loansApi.listLoans({ limit: 50, offset: 0 });
        setLoans(res.items);
      } catch {
        setLoans([]);
      } finally {
        setLoansLoading(false);
      }
    })();
  }, []);

  async function downloadStatement() {
    if (!selectedLoan) return;
    setDownloadingStatement(true);
    try {
      const { url, headers } = await documentsApi.getStatementDownloadInfo(selectedLoan.id);
      const destination = new File(Paths.cache, `statement-${selectedLoan.id}.pdf`);
      const file = await File.downloadFileAsync(url, destination, { headers, idempotent: true });
      try {
        await Print.printAsync({ uri: file.uri });
      } catch {
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(file.uri);
        }
      }
    } catch {
      Alert.alert("Could not download statement", "Please try again later.");
    } finally {
      setDownloadingStatement(false);
    }
  }

  async function downloadKYCDoc(row: KYCDocRow) {
    if (!row.url) return;
    setDownloadingKey(row.key);
    try {
      const destination = new File(Paths.cache, `kyc-${row.key}${extname(row.url)}`);
      const file = await File.downloadFileAsync(row.url, destination, { idempotent: true });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri);
      } else {
        Alert.alert("Sharing unavailable", "Your device can't open shared files right now.");
      }
    } catch {
      Alert.alert("Could not open document", "Please try again later.");
    } finally {
      setDownloadingKey(null);
    }
  }

  const kycDocs: KYCDocRow[] = [
    { key: "identity", label: "Identity Proof", icon: "doc", url: customer?.identityProofUrl },
    { key: "address", label: "Address Proof", icon: "doc", url: customer?.addressProofUrl },
    { key: "kyc", label: "KYC Document", icon: "doc", url: customer?.kycDocumentUrl },
  ];
  const availableDocs = kycDocs.filter((d) => !!d.url);

  return (
    <View style={{ flex: 1, backgroundColor: colors.ivory }}>
      <FloatingHeader title="Documents" navigation={undefined} onBellPress={() => setNotifOpen(true)} />
      <ScreenContainer>
        <ScrollView showsVerticalScrollIndicator={false}>
          <ThemedText variant="label" color={colors.muted} style={styles.sectionLabel}>
            LOAN STATEMENT
          </ThemedText>
          <Card>
            <Pressable onPress={() => setPickerOpen(true)} style={styles.pickerField}>
              <ThemedText variant="body" color={selectedLoan ? colors.ink : colors.muted}>
                {selectedLoan ? selectedLoan.loanNumber : "Select loan"}
              </ThemedText>
              <View style={{ transform: [{ rotate: "-90deg" }] }}>
                <Icon name="chevronLeft" size={16} color={colors.muted} />
              </View>
            </Pressable>
            {selectedLoan ? (
              <ThemedText variant="small" color={colors.muted} style={{ marginTop: 6 }}>
                Outstanding {money(selectedLoan.totalOutstandingBalance ?? selectedLoan.outstandingAmount)}
              </ThemedText>
            ) : null}
            <GoldButton
              title="Download Statement"
              onPress={downloadStatement}
              disabled={!selectedLoan}
              loading={downloadingStatement}
              style={{ marginTop: 12 }}
            />
          </Card>

          <ThemedText variant="label" color={colors.muted} style={styles.sectionLabel}>
            MY DOCUMENTS
          </ThemedText>
          <Card>
            {availableDocs.length ? (
              availableDocs.map((doc, idx) => (
                <React.Fragment key={doc.key}>
                  <Pressable
                    onPress={() => downloadKYCDoc(doc)}
                    disabled={downloadingKey === doc.key}
                    style={styles.docRow}
                  >
                    <Icon name={doc.icon} size={18} color={colors.goldDeep} />
                    <ThemedText variant="body" style={{ flex: 1, marginLeft: 10 }}>
                      {doc.label}
                    </ThemedText>
                    {downloadingKey === doc.key ? (
                      <ActivityIndicator color={colors.gold} size="small" />
                    ) : (
                      <Icon name="doc" size={18} color={colors.muted} />
                    )}
                  </Pressable>
                  {idx < availableDocs.length - 1 ? <View style={styles.divider} /> : null}
                </React.Fragment>
              ))
            ) : (
              <ThemedText variant="body" color={colors.muted}>
                No documents uploaded yet. Contact your branch.
              </ThemedText>
            )}
          </Card>
        </ScrollView>
      </ScreenContainer>

      <BottomSheetModal visible={pickerOpen} onClose={() => setPickerOpen(false)} maxHeightPct={60}>
        <ThemedText variant="h3" style={{ marginBottom: 12 }}>
          Select a loan
        </ThemedText>
        {loansLoading ? (
          <ActivityIndicator color={colors.gold} />
        ) : loans.length ? (
          loans.map((l) => (
            <Pressable
              key={l.id}
              onPress={() => {
                setSelectedLoan(l);
                setPickerOpen(false);
              }}
              style={styles.pickerRow}
            >
              <View>
                <ThemedText variant="body">{l.loanNumber}</ThemedText>
                <ThemedText variant="small" color={colors.muted}>
                  Outstanding {money(l.totalOutstandingBalance ?? l.outstandingAmount)}
                </ThemedText>
              </View>
            </Pressable>
          ))
        ) : (
          <ThemedText variant="small" color={colors.muted}>
            No loans found.
          </ThemedText>
        )}
      </BottomSheetModal>

      <BottomSheetModal visible={notifOpen} onClose={() => setNotifOpen(false)} maxHeightPct={60} dragToClose={false}>
        <NotificationList />
      </BottomSheetModal>
    </View>
  );
}

const styles = StyleSheet.create({
  sectionLabel: { marginBottom: 6, marginTop: 4 },
  pickerField: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    height: 48,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
    paddingHorizontal: 14,
  },
  pickerRow: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  docRow: { flexDirection: "row", alignItems: "center", paddingVertical: 10 },
  divider: { height: 1, backgroundColor: colors.line },
});
