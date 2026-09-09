import React, { useEffect, useRef } from "react";
import { BackHandler, View, StyleSheet, ActivityIndicator, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView, WebViewMessageEvent } from "react-native-webview";
import { ThemedText } from "./ThemedText";
import { Icon } from "./Icon";
import { colors } from "../theme/colors";
import { nextSheetId, sheetStore } from "./SheetHost";

// Solution A (Expo Go compatible) for the react-native-razorpay-in-Expo-Go
// gap: `react-native-razorpay` needs a native module (RNRazorpayCheckout)
// that plain Expo Go doesn't have — see PaySheet.tsx's RAZORPAY_NATIVE_AVAILABLE
// check. This component loads Razorpay's own hosted Web Checkout script
// (https://checkout.razorpay.com/v1/checkout.js) inside a WebView instead —
// no native module required, works in Expo Go — and bridges its callbacks
// back to React Native via `window.ReactNativeWebView.postMessage`.
// Solution B (native checkout via a dev-client build) remains the primary
// path in PaySheet.tsx when the native module IS available; this is only
// the fallback.

export type RazorpayWebCheckoutOptions = {
  key: string;
  order_id: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
};

// Razorpay's checkout can fire `modal.ondismiss` right around — occasionally
// even fractionally before — the real success `handler` callback when
// embedded in a WebView (the two are independent JS events with no
// guaranteed ordering here, unlike a real browser tab). Treating dismiss as
// an instant, unconditional cancel meant a genuinely completed payment
// could get silently discarded, dumping the customer back at the amount
// screen with no feedback at all. Debouncing dismiss by this long lets a
// trailing success message still win.
const DISMISS_GRACE_MS = 1200;

export type RazorpayWebCheckoutSuccess = {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
};

// Builds the HTML page the WebView loads: pulls in Razorpay's script tag,
// constructs `new Razorpay(options)` with the options baked in, and posts a
// JSON message back to React Native on every outcome (success, failure,
// or the user dismissing the modal) — postMessage is the one bridge a
// sandboxed WebView page always has back to its host, no other wiring
// needed.
function buildCheckoutHtml(options: RazorpayWebCheckoutOptions): string {
  const optionsJson = JSON.stringify(options).replace(/</g, "\\u003c");
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, interactive-widget=resizes-content" />
  <style>
    /* 100dvh (dynamic viewport height) tracks the *visible* viewport as the
       keyboard opens/closes, unlike 100% (which stays pinned to the
       original full-screen height) — without this, the page keeps laying
       out against the pre-keyboard height while the WebView's actual
       drawable area has already shrunk, leaving a large dead gap between
       the input/keyboard and whatever Razorpay's checkout thinks the
       bottom of the page is. 100% is kept as a fallback for older WebViews
       that don't support dvh. */
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
    /* Razorpay's checkout renders itself inside an iframe it injects into
       the page. That iframe is meant to fill the viewport, but its sizing
       is computed from window.innerHeight at creation time and doesn't
       reliably track later Android WebView viewport changes (keyboard
       open/close, or an unusual initial size) — that's the blank gap
       above/below the checkout content. !important overrides its own
       inline style, which otherwise wins. This is a best-effort fix
       against a third-party widget's internals, not a guaranteed one. */
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
  <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
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

export function RazorpayWebCheckout({
  options,
  onSuccess,
  onCancel,
  onFailed,
  onError,
}: {
  // null hides the modal entirely — PaySheet controls visibility purely by
  // setting/clearing this.
  options: RazorpayWebCheckoutOptions | null;
  onSuccess: (result: RazorpayWebCheckoutSuccess) => void;
  onCancel: () => void;
  onFailed: (description: string) => void;
  onError: (message: string) => void;
}) {
  const insets = useSafeAreaInsets();

  const idRef = useRef<string | undefined>(undefined);
  if (!idRef.current) idRef.current = nextSheetId();
  const id = idRef.current;

  // settledRef flips true the instant ANY terminal outcome (success/failed/
  // error) is known — used to make a same-or-later "dismiss" a no-op rather
  // than clobbering an outcome already in flight. dismissTimerRef holds the
  // debounce timer for a "dismiss" that arrived with nothing else settled
  // yet (see DISMISS_GRACE_MS above).
  const settledRef = useRef(false);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset both on every new checkout attempt (a new order_id) — otherwise a
  // stale settledRef=true from a previous attempt would swallow this one's
  // first message.
  useEffect(() => {
    settledRef.current = false;
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
  }, [options?.order_id]);

  // Idempotent — whichever outcome (success/failed/error/explicit cancel)
  // reaches here FIRST wins; every later call is a no-op. Without this, a
  // Cancel tap racing a same-instant success postMessage could fire both
  // onCancel and onSuccess for one checkout attempt.
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
        if (settledRef.current) return; // a success/failed/error already won — nothing to debounce
        dismissTimerRef.current = setTimeout(() => {
          dismissTimerRef.current = null;
          settle(onCancel); // settle() itself is idempotent, so this is safe even if something else won in the meantime
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

  // The header's explicit Cancel button (and the hardware back button below)
  // are real, deliberate user actions — bypass the debounce entirely and
  // settle immediately.
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

  // Published into SheetHost rather than a real react-native <Modal> — same
  // reason as BottomSheetModal.tsx: an Android <Modal> renders as a
  // separate Dialog Window, which does NOT inherit the main Activity's
  // android:windowSoftInputMode (set to "pan" in app.json specifically so
  // this checkout page's own keyboard handling, below, is the only thing
  // that reacts when the keyboard opens). Inside a Modal that setting was
  // silently ignored, so the native window resized on top of the WebView's
  // own resize, doubling how far the page visibly rose.
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
            {/* Android adds extra vertical padding to text by default
                (includeFontPadding, for accent/descender room) that the
                adjacent icon's precise glyph box doesn't have — with
                alignItems:"center" centering each element's own box rather
                than its visible ink, that alone was enough to make "Cancel"
                read as sitting below center next to the icon.
                includeFontPadding:false trims most of it, and pinning
                lineHeight to the icon's own size (rather than leaving it to
                the body font's natural, taller line metrics) makes the two boxes
                actually match so alignItems:"center" centers them the same
                way. */}
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
