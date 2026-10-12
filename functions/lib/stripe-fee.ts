/** ACH processing fee: 0.8% of the payment, capped at $5.00. */
export function achFee(amount: number): number {
  return Math.min(Math.round(amount * 0.008 * 100) / 100, 5);
}

/** Card processing fee: 2.9% + $0.30 per transaction. */
export function cardFee(amount: number): number {
  return Math.round((amount * 0.029 + 0.30) * 100) / 100;
}

/** Return the processing fee for a given Stripe payment method type. */
export function stripeFee(amount: number, methodType: 'us_bank_account' | 'card'): number {
  return methodType === 'card' ? cardFee(amount) : achFee(amount);
}
