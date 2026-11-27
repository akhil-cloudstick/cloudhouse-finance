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

// Pulls the signing link out of the notification body text; there's no separate "start" endpoint to call.
const URL_RE = /https?:\/\/\S+/;

function langFromBody(body: string): string {
  if (/gujarati/i.test(body)) return "Gujarati";
  if (/tamil/i.test(body)) return "Tamil";
  if (/hindi/i.test(body)) return "Hindi";
  return "English";
}

// Renders nothing when there's no pending eSign; shows only the single most recent one.
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

      // Poll status server-side regardless of how the browser session resolves; that's the real signal.
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
