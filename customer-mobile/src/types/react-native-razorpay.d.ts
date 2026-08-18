// react-native-razorpay ships no TypeScript declarations. This mirrors the
// subset of its native SDK surface PaySheet.tsx uses — see
// https://razorpay.com/docs/payments/payment-gateway/react-native-integration/standard/build-integration/
declare module "react-native-razorpay" {
  export type RazorpayOptions = {
    key: string;
    order_id: string;
    amount: number;
    currency: string;
    name?: string;
    description?: string;
    image?: string;
    prefill?: { email?: string; contact?: string; name?: string };
    theme?: { color?: string };
  };

  export type RazorpaySuccessResult = {
    razorpay_payment_id: string;
    razorpay_order_id: string;
    razorpay_signature: string;
  };

  export type RazorpayErrorResult = {
    code: number;
    description: string;
  };

  const RazorpayCheckout: {
    open: (options: RazorpayOptions) => Promise<RazorpaySuccessResult>;
  };

  export default RazorpayCheckout;
}
