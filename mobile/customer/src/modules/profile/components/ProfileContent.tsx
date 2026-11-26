import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, ScrollView, ActivityIndicator, StyleSheet, Alert, Image } from "react-native";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { ScreenContainer } from "@/common/components/layout/ScreenContainer";
import { Card } from "@/common/components/ui/Card";
import { ThemedText } from "@/common/components/ui/ThemedText";
import { BottomSheetModal } from "@/common/components/ui/BottomSheetModal";
import { GoldButton } from "@/common/components/ui/GoldButton";
import { Icon } from "@/common/components/ui/Icon";
import { colors, statusColors, StatusTone } from "@/common/theme/colors";
import { useAuth } from "@/common/providers/AuthProvider";
import * as profileApi from "@/common/services/profileService";
import { Customer, KYCStatusValue } from "@/common/types/customer-types";
import { ApiError, resolveAssetUrl } from "@/common/services/httpClient";

function toneForKYC(status: KYCStatusValue | string): StatusTone {
  switch (status) {
    case "Verified":
      return "green";
    case "Pending":
      return "amber";
    default:
      return "red";
  }
}

type StatusPillProps = { status: KYCStatusValue | string };

function StatusPill({ status }: StatusPillProps) {
  const tone = statusColors(toneForKYC(status));
  return (
    <ThemedText
      variant="label"
      style={{ backgroundColor: tone.bg, color: tone.fg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 }}
    >
      {status.toUpperCase()}
    </ThemedText>
  );
}

type Outcome = { text: string; tone: "green" | "red" } | null;

function outcomeForStatus(status: string, kind: "PAN" | "Aadhaar"): Outcome {
  switch (status) {
    case "Verified":
      return { text: `${kind} Verified`, tone: "green" };
    case "Name Mismatch":
      return { text: "Name Mismatch — contact your branch", tone: "red" };
    default:
      return { text: `${kind} Verification Failed`, tone: "red" };
  }
}

type ProfileContentProps = { footer?: React.ReactNode };

export function ProfileContent({ footer }: ProfileContentProps) {
  const { customer: authCustomer, refreshProfile } = useAuth();
  const [profile, setProfile] = useState<Customer | null>(authCustomer);
  const [loading, setLoading] = useState(!authCustomer);
  const [error, setError] = useState<string | null>(null);

  const [panVerifying, setPanVerifying] = useState(false);
  const [panOutcome, setPanOutcome] = useState<Outcome>(null);

  const [aadhaarPolling, setAadhaarPolling] = useState(false);
  const [aadhaarOutcome, setAadhaarOutcome] = useState<Outcome>(null);
  const pollCancelled = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rec = await profileApi.getProfile();
      setProfile(rec);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load your profile.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function verifyPAN() {
    setPanVerifying(true);
    setPanOutcome(null);
    try {
      const res = await profileApi.verifyPAN();
      setProfile(res.customer);
      refreshProfile().catch(() => {});
      setPanOutcome(outcomeForStatus(res.customer.panStatus, "PAN"));
    } catch (err) {
      Alert.alert("Could not verify PAN", err instanceof ApiError ? err.message : "Please try again later.");
    } finally {
      setPanVerifying(false);
    }
  }

  async function verifyAadhaar() {
    setAadhaarOutcome(null);
    try {
      const redirectUrl = Linking.createURL("aadhaar-callback");
      const start = await profileApi.startAadhaarVerify(redirectUrl);
      pollCancelled.current = false;
      setAadhaarPolling(true);

      // Poll status server-side regardless of how the browser session resolves; that's the real verification.
      await WebBrowser.openAuthSessionAsync(start.url, redirectUrl);

      for (let attempt = 0; attempt < 10 && !pollCancelled.current; attempt++) {
        await new Promise((r) => setTimeout(r, 3000));
        if (pollCancelled.current) break;
        const res = await profileApi.checkAadhaarVerify();
        if (res.status === "authenticated" && res.customer) {
          setProfile(res.customer);
          refreshProfile().catch(() => {});
          setAadhaarOutcome(outcomeForStatus(res.customer.aadhaarStatus, "Aadhaar"));
          setAadhaarPolling(false);
          return;
        }
      }
      if (!pollCancelled.current) {
        setAadhaarOutcome({ text: "Verification timed out — please try again.", tone: "red" });
      }
      setAadhaarPolling(false);
    } catch (err) {
      setAadhaarPolling(false);
      Alert.alert("Could not verify Aadhaar", err instanceof ApiError ? err.message : "Please try again later.");
    }
  }

  function cancelAadhaarPoll() {
    pollCancelled.current = true;
    setAadhaarPolling(false);
  }

  if (loading && !profile) {
    return (
      <ScreenContainer style={{ alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={colors.brand} />
      </ScreenContainer>
    );
  }

  if (error || !profile) {
    return (
      <ScreenContainer style={{ alignItems: "center", justifyContent: "center" }}>
        <ThemedText color={colors.muted}>{error ?? "Profile not found."}</ThemedText>
      </ScreenContainer>
    );
  }

  const initials = profile.name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const hasNominee = !!profile.nomineeName;

  return (
    <>
      <ScreenContainer>
        <ScrollView showsVerticalScrollIndicator={false}>
          <View style={styles.headerBlock}>
            {profile.photoUrl ? (
              <Image source={{ uri: resolveAssetUrl(profile.photoUrl) }} style={styles.avatarLg} />
            ) : (
              <View style={styles.avatarLg}>
                <ThemedText variant="h2" color={colors.card}>
                  {initials || "?"}
                </ThemedText>
              </View>
            )}
            <ThemedText variant="h3" style={{ marginTop: 10 }}>
              {profile.name}
            </ThemedText>
            <ThemedText variant="small" color={colors.muted}>
              Customer Code: {profile.code}
            </ThemedText>
          </View>

          <ThemedText variant="label" color={colors.muted} style={styles.sectionLabel}>
            IDENTITY
          </ThemedText>
          <Card>
            <Row label="Phone" value={profile.phone} />
            {profile.dob ? <Row label="Date of Birth" value={new Date(profile.dob).toLocaleDateString("en-IN")} /> : null}
            {profile.address ? <Row label="Address" value={profile.address} /> : null}
            {profile.branch?.name ? <Row label="Branch" value={profile.branch.name} /> : null}
          </Card>

          <ThemedText variant="label" color={colors.muted} style={styles.sectionLabel}>
            NOMINEE
          </ThemedText>
          <Card>
            {hasNominee ? (
              <>
                <Row label="Name" value={profile.nomineeName} />
                {profile.nomineeRelation ? <Row label="Relation" value={profile.nomineeRelation} /> : null}
                {profile.nomineePhone ? <Row label="Phone" value={profile.nomineePhone} /> : null}
              </>
            ) : (
              <ThemedText variant="body" color={colors.muted}>
                Not added
              </ThemedText>
            )}
          </Card>

          <ThemedText variant="label" color={colors.muted} style={styles.sectionLabel}>
            KYC VERIFICATION
          </ThemedText>
          <Card>
            <Row label="Overall KYC">
              <StatusPill status={profile.kycStatus} />
            </Row>
            <View style={styles.divider} />

            <View style={styles.kycRow}>
              <Icon name="doc" size={18} color={colors.brandDeep} />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <ThemedText variant="body">PAN</ThemedText>
                {profile.pan ? (
                  <ThemedText variant="small" color={colors.muted}>
                    {profile.pan}
                  </ThemedText>
                ) : null}
                {panOutcome ? (
                  <ThemedText variant="small" color={panOutcome.tone === "green" ? colors.green : colors.red}>
                    {panOutcome.text}
                  </ThemedText>
                ) : (
                  <StatusPill status={profile.panStatus} />
                )}
              </View>
              {!profile.pan ? (
                <ThemedText variant="small" color={colors.muted} style={{ maxWidth: 120, textAlign: "right" }}>
                  Contact your branch to add a PAN
                </ThemedText>
              ) : profile.panStatus !== "Verified" ? (
                <GoldButton title="Verify" variant="outline" loading={panVerifying} onPress={verifyPAN} style={styles.verifyBtn} />
              ) : null}
            </View>
            <View style={styles.divider} />

            <View style={styles.kycRow}>
              <Icon name="shield" size={18} color={colors.brandDeep} />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <ThemedText variant="body">Aadhaar</ThemedText>
                {profile.aadhaarLast4 ? (
                  <ThemedText variant="small" color={colors.muted}>
                    XXXX-XXXX-{profile.aadhaarLast4}
                  </ThemedText>
                ) : null}
                {aadhaarOutcome ? (
                  <ThemedText variant="small" color={aadhaarOutcome.tone === "green" ? colors.green : colors.red}>
                    {aadhaarOutcome.text}
                  </ThemedText>
                ) : (
                  <StatusPill status={profile.aadhaarStatus} />
                )}
              </View>
              {profile.aadhaarStatus !== "Verified" ? (
                <GoldButton title="Verify" variant="outline" loading={aadhaarPolling} onPress={verifyAadhaar} style={styles.verifyBtn} />
              ) : null}
            </View>
          </Card>

          {footer}
        </ScrollView>
      </ScreenContainer>

      <BottomSheetModal visible={aadhaarPolling} onClose={cancelAadhaarPoll} maxHeightPct={40}>
        <ThemedText variant="h3" style={{ marginBottom: 12, textAlign: "center" }}>
          Verifying Aadhaar…
        </ThemedText>
        <ActivityIndicator color={colors.brand} style={{ marginBottom: 16 }} />
        <ThemedText variant="small" color={colors.muted} style={{ textAlign: "center", marginBottom: 20 }}>
          Complete the DigiLocker login in the browser, then return here — this may take a moment.
        </ThemedText>
        <GoldButton title="Cancel" variant="outline" onPress={cancelAadhaarPoll} />
      </BottomSheetModal>
    </>
  );
}

type RowProps = { label: string; value?: string; children?: React.ReactNode };

function Row({ label, value, children }: RowProps) {
  return (
    <View style={styles.row}>
      <ThemedText variant="small" color={colors.muted}>
        {label}
      </ThemedText>
      {children ?? (
        <ThemedText variant="body" color={colors.ink} style={{ flexShrink: 1, textAlign: "right" }}>
          {value}
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  headerBlock: { alignItems: "center", marginBottom: 20, marginTop: 8 },
  avatarLg: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.brandDeep,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionLabel: { marginBottom: 6, marginTop: 4 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 6,
    gap: 12,
  },
  divider: { height: 1, backgroundColor: colors.line, marginVertical: 8 },
  kycRow: { flexDirection: "row", alignItems: "flex-start", paddingVertical: 4 },
  verifyBtn: { height: 36, paddingHorizontal: 12 },
});
