/** ACH processing fee: 0.8% of the payment, capped at $5.00. */
export function achFee(amount: number): number {
  return Math.min(Math.round(amount * 0.008 * 100) / 100, 5);
}
