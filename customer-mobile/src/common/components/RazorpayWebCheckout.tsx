import React, { useEffect, useRef } from "react";
import { BackHandler, View, StyleSheet, ActivityIndicator, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView, WebViewMessageEvent } from "react-native-webview";
import { ThemedText } from "@/common/components/ui/ThemedText";
import { Icon } from "@/common/components/ui/Icon";
import { colors } from "@/common/theme/colors";
import { nextSheetId, sheetStore } from "@/common/components/ui/SheetHost";
import { RAZORPAY_CHECKOUT_URL } from "@/common/services/httpClient";

// Expo Go fallback: loads Razorpay's hosted Web Checkout in a WebView since the native module isn't available there.

export type RazorpayWebCheckoutOptions = {
  key: string;
  order_id: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
};

// Debounce dismiss: modal.ondismiss can fire before/around the success callback in a WebView, with no guaranteed order.
const DISMISS_GRACE_MS = 1200;

export type RazorpayWebCheckoutSuccess = {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
};

function buildCheckoutHtml(options: RazorpayWebCheckoutOptions): string {
  const optionsJson = JSON.stringify(options).replace(/</g, "\\u003c");
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, interactive-widget=resizes-content" />
  <style>
    /* 100dvh tracks the visible viewport as the keyboard opens/closes; 100% is a fallback for older WebViews. */
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      height: 100dvh;
      background: #f7f6fb;
      overflow: hidden;
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      touch-action: none;
    }
    /* !important overrides Razorpay's injected iframe inline sizing, which otherwise ignores later viewport changes. */
    iframe {
      position: fixed !important;
      top: 0 !important;
      left: 0 !important;
      width: 100% !important;
      height: 100% !important;
      height: 100dvh !important;
      border: none !important;
      margin: 0 !important;
      padding: 0 !important;
    }
  </style>
</head>
<body>
  <script src="${RAZORPAY_CHECKOUT_URL}"></script>
  <script>
    function post(message) {
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify(message));
      }
    }

    function lockScroll() {
      window.scrollTo(0, 0);
      if (document.body) document.body.scrollTop = 0;
      if (document.documentElement) document.documentElement.scrollTop = 0;
    }

    window.addEventListener("scroll", lockScroll, { passive: false });
    document.addEventListener("scroll", lockScroll, { passive: false });
    window.addEventListener("focusin", function () {
      setTimeout(lockScroll, 50);
      setTimeout(lockScroll, 150);
      setTimeout(lockScroll, 300);
    });

    if (window.visualViewport) {
      window.visualViewport.addEventListener("scroll", lockScroll, { passive: false });
      window.visualViewport.addEventListener("resize", function () {
        lockScroll();
        window.dispatchEvent(new Event("resize"));
      }, { passive: false });
    }

    try {
      var options = ${optionsJson};
      options.handler = function (response) {
        post({ type: "success", payload: response });
      };
      options.modal = {
        ondismiss: function () {
          post({ type: "dismiss" });
        }
      };
      var rzp = new Razorpay(options);
      rzp.on("payment.failed", function (response) {
        post({ type: "failed", payload: (response && response.error) || {} });
      });
      rzp.open();
    } catch (e) {
      post({ type: "error", payload: String(e && e.message ? e.message : e) });
    }
  </script>
</body>
</html>`;
}

type RazorpayWebCheckoutProps = {
  // null hides the modal; PaySheet controls visibility by setting/clearing this.
  options: RazorpayWebCheckoutOptions | null;
  onSuccess: (result: RazorpayWebCheckoutSuccess) => void;
  onCancel: () => void;
  onFailed: (description: string) => void;
  onError: (message: string) => void;
};

export function RazorpayWebCheckout({
  options,
  onSuccess,
  onCancel,
  onFailed,
  onError,
}: RazorpayWebCheckoutProps) {
  const insets = useSafeAreaInsets();

  const idRef = useRef<string | undefined>(undefined);
  if (!idRef.current) idRef.current = nextSheetId();
  const id = idRef.current;

  const settledRef = useRef(false);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset on every new attempt so a stale settledRef from a previous order doesn't swallow this one.
  useEffect(() => {
    settledRef.current = false;
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
  }, [options?.order_id]);

  // Idempotent: first outcome to reach here wins, later calls are no-ops (avoids firing both cancel and success).
  function settle(action: () => void) {
    if (settledRef.current) return;
    settledRef.current = true;
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
    action();
  }

  function handleMessage(event: WebViewMessageEvent) {
    let msg: { type: string; payload?: any } | null = null;
    try {
      msg = JSON.parse(event.nativeEvent.data);
    } catch {
      settle(() => onError("Unexpected response from the payment gateway."));
      return;
    }
    if (!msg) return;
    switch (msg.type) {
      case "success":
        settle(() => onSuccess(msg.payload));
        break;
      case "dismiss":
        if (settledRef.current) return;
        dismissTimerRef.current = setTimeout(() => {
          dismissTimerRef.current = null;
          settle(onCancel);
        }, DISMISS_GRACE_MS);
        break;
      case "failed":
        settle(() => onFailed(msg.payload?.description || "Payment failed."));
        break;
      case "error":
        settle(() => onError(msg.payload || "Could not start the payment gateway."));
        break;
    }
  }

  // Explicit Cancel/back actions bypass the dismiss debounce and settle immediately.
  function cancelNow() {
    settle(onCancel);
  }

  useEffect(() => {
    if (!options) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      cancelNow();
      return true;
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options]);

  // Rendered via SheetHost, not <Modal>: Android Modal ignores windowSoftInputMode, see BottomSheetModal.tsx.
  useEffect(() => {
    if (!options) {
      sheetStore.remove(id);
      return;
    }
    sheetStore.set(
      id,
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Pressable onPress={cancelNow} hitSlop={10} style={styles.closeBtn}>
            <Icon name="chevronLeft" size={20} color={colors.ink} />
            {/* includeFontPadding/lineHeight fix Android's default text padding making "Cancel" look off-center next to the icon. */}
            <ThemedText variant="body" style={{ marginLeft: 4, includeFontPadding: false, lineHeight: 20 }}>
              Cancel
            </ThemedText>
          </Pressable>
        </View>
        <WebView
          key={options.order_id}
          originWhitelist={["*"]}
          source={{ html: buildCheckoutHtml(options) }}
          onMessage={handleMessage}
          javaScriptEnabled
          domStorageEnabled
          mixedContentMode="always"
          startInLoadingState
          scrollEnabled={false}
          overScrollMode="never"
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
          renderLoading={() => (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.brand} />
            </View>
          )}
          onError={() => settle(() => onError("Could not load the payment gateway. Check your connection and try again."))}
        />
      </View>
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options, insets.top]);

  useEffect(() => () => sheetStore.remove(id), [id]);

  return null;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    height: 52,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  closeBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
  },
  loading: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg },
});
