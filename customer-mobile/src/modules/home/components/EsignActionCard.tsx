import React, { useRef, useState } from "react";
import { View, Alert } from "react-native";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { Card } from "@/common/components/ui/Card";
import { ThemedText } from "@/common/components/ui/ThemedText";
import { GoldButton } from "@/common/components/ui/GoldButton";
import { BottomSheetModal } from "@/common/components/ui/BottomSheetModal";
import { colors } from "@/common/theme/colors";
import { useNotifications } from "@/common/providers/NotificationsProvider";
import { Notification } from "@/common/services/notificationService";
import { checkIndemnityBondEsign } from "@/modules/home/services/esignService";
import { ApiError } from "@/common/services/httpClient";

// URL_RE pulls the Setu signing link out of the notification's own body
// text — see backend/internal/loan/service.go's deliverEsignLink, which
// builds that body as "...Open this link on your own phone to complete
// it: https://...". There is deliberately no separate "start" endpoint for
// this app to call (see src/modules/home/services/esignService.ts's doc comment): the link a staff
// member already sent IS the delivery, so this card's only job is
// surfacing it and then polling status — same shape as ProfileContent.tsx's
// verifyAadhaar()/DigiLocker flow.
const URL_RE = /https?:\/\/\S+/;

function langFromBody(body: string): string {
  if (/gujarati/i.test(body)) return "Gujarati";
  if (/hindi/i.test(body)) return "Hindi";
  return "English";
}

/** Renders nothing once there's no pending eSign notification to show — Home
 * screen just drops this in unconditionally rather than computing that
 * itself. Shows only the SINGLE most recent one: a customer with two loans
 * both awaiting signature still only needs to act on one at a time. */
export function EsignActionCard() {
  const { items, markRead } = useNotifications();
  const [dismissedIds, setDismissedIds] = useState<number[]>([]);
  const [polling, setPolling] = useState(false);
  const pollCancelled = useRef(false);

  const pending = items
    .filter((n) => n.type === "IndemnityBondEsignReady" && !dismissedIds.includes(n.id))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

  if (!pending) return null;

  const url = pending.body.match(URL_RE)?.[0];
  const lang = langFromBody(pending.body);
  const loanId = pending.relatedEntityType === "loan" ? pending.relatedEntityId : undefined;

  async function signNow() {
    if (!url || !loanId) return;
    try {
      const redirectUrl = Linking.createURL("esign-callback");
      pollCancelled.current = false;
      setPolling(true);

      // Regardless of how the browser session resolves (success/cancel/
      // dismiss) we poll status server-side — that's the real signal,
      // not the browser's own resolution. Same pattern as Aadhaar KYC.
      await WebBrowser.openAuthSessionAsync(url, redirectUrl);

      for (let attempt = 0; attempt < 10 && !pollCancelled.current; attempt++) {
        await new Promise((r) => setTimeout(r, 3000));
        if (pollCancelled.current) break;
        const res = await checkIndemnityBondEsign(loanId);
        if (res.status === "sign_complete") {
          setPolling(false);
          markRead(pending.id);
          setDismissedIds((ids) => [...ids, pending.id]);
          Alert.alert("Signed", "Your pledge agreement has been signed successfully.");
          return;
        }
        if (res.status === "failed") {
          setPolling(false);
          Alert.alert("eSign failed", "Aadhaar eSign didn't complete — please try again, or ask your branch to resend it.");
          return;
        }
      }
      if (!pollCancelled.current) {
        setPolling(false);
        Alert.alert(
          "Still pending",
          "We haven't seen a completed signature yet. If you finished signing, check back shortly — otherwise try again."
        );
      }
    } catch (err) {
      setPolling(false);
      Alert.alert("Could not open eSign", err instanceof ApiError ? err.message : "Please try again later.");
    }
  }

  function cancelPoll() {
    pollCancelled.current = true;
    setPolling(false);
  }

  return (
    <>
      <Card style={{ borderColor: colors.brand, backgroundColor: colors.brandPale }}>
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 6 }}>
          <ThemedText variant="h3" color={colors.brandDeep} style={{ flex: 1 }}>
            ✍️ Action Required
          </ThemedText>
        </View>
        <ThemedText variant="body" style={{ marginBottom: 12 }}>
          Your pledge agreement is ready to sign — {lang} version.
        </ThemedText>
        <GoldButton title="Review & Sign with Aadhaar" onPress={signNow} disabled={!url} />
      </Card>

      <BottomSheetModal visible={polling} onClose={cancelPoll} maxHeightPct={40}>
        <ThemedText variant="h3" style={{ marginBottom: 8 }}>
          Verifying…
        </ThemedText>
        <ThemedText variant="small" color={colors.muted} style={{ marginBottom: 14 }}>
          Checking whether your Aadhaar eSign has been completed.
        </ThemedText>
        <GoldButton title="Cancel" variant="outline" onPress={cancelPoll} />
      </BottomSheetModal>
    </>
  );
}
