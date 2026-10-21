// react-native-razorpay ships no TypeScript declarations; mirrors the subset of its native SDK PaySheet.tsx uses.
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
