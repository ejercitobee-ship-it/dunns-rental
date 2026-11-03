/** ACH processing fee: covers Stripe's 0.8% on the total charge, capped at $5.00. */
export function achFee(amount: number): number {
  return Math.min(Math.round(((amount * 0.008) / (1 - 0.008)) * 100) / 100, 5);
}

/** Card processing fee: covers Stripe's 2.9% + $0.30 on the total charge. */
export function cardFee(amount: number): number {
  return Math.round(((amount * 0.029 + 0.30) / (1 - 0.029)) * 100) / 100;
}

/** Return the processing fee for a given Stripe payment method type. */
export function stripeFee(amount: number, methodType: 'us_bank_account' | 'card'): number {
  return methodType === 'card' ? cardFee(amount) : achFee(amount);
}
