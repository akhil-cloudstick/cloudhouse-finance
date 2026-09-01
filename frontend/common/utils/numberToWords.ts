/* Converts a rupee amount to words, Indian numbering (crore/lakh/thousand),
 * e.g. 1234567 -> "One Crore Twenty-Three Lakh Forty-Five Thousand Six
 * Hundred Sixty-Seven". Used to satisfy the statement of account's
 * statutory "amount in words and figures" requirement — see
 * modules/loans/utils/statement.ts. Paise are dropped (loans are tracked
 * to the rupee in every other printed document already). */
const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen",
];
const TENS = [
  "", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety",
];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n];
  const t = Math.floor(n / 10);
  const o = n % 10;
  return TENS[t] + (o ? "-" + ONES[o] : "");
}

function threeDigits(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const parts = [];
  if (h) parts.push(ONES[h] + " Hundred");
  if (rest) parts.push(twoDigits(rest));
  return parts.join(" ");
}

export function numberToIndianWords(n: number): string {
  n = Math.round(Math.abs(n));
  if (n === 0) return "Zero";

  const crore = Math.floor(n / 1e7);
  n %= 1e7;
  const lakh = Math.floor(n / 1e5);
  n %= 1e5;
  const thousand = Math.floor(n / 1e3);
  n %= 1e3;
  const hundred = n;

  const parts: string[] = [];
  if (crore) parts.push(threeDigits(crore) + " Crore");
  if (lakh) parts.push(threeDigits(lakh) + " Lakh");
  if (thousand) parts.push(threeDigits(thousand) + " Thousand");
  if (hundred) parts.push(threeDigits(hundred));
  return parts.join(" ");
}

export function rupeesInWords(amount?: number): string {
  if (amount == null || !isFinite(amount)) return "";
  return "Rupees " + numberToIndianWords(amount) + " Only";
}
