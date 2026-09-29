import { useCallback, useEffect, useState } from 'react';
import { CreditCard, Building2, Trash2, Loader2, CheckCircle, AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '../ui/Button';
import { Card, CardContent } from '../ui/Card';
import { portalApi, type StripePaymentMethod } from '../../lib/api';
import { getStripeJs } from '../../lib/stripe';
import { formatCurrency } from '../../lib/utils';
import { useToast } from '../../context/ToastContext';

/** ACH processing fee: 0.8% capped at $5. Matches functions/lib/stripe-fee.ts. */
function achFee(amount: number): number {
  return Math.min(Math.round(amount * 0.008 * 100) / 100, 5);
}

interface PayRentProps {
  leaseId: string;
  amount: number;
  month: number;
  year: number;
  monthLabel: string;
  status: 'paid' | 'partial' | 'unpaid' | null;
  balance: number;
  tenantName: string;
  onPaymentStarted?: () => void;
}

export function PayRent({ leaseId, amount, month, year, monthLabel, status, balance, tenantName, onPaymentStarted }: PayRentProps) {
  const { showToast } = useToast();
  const [methods, setMethods] = useState<StripePaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [linking, setLinking] = useState(false);
  const [paying, setPaying] = useState(false);
  const [payResult, setPayResult] = useState<'processing' | 'failed' | null>(null);

  const [autopayEnabled, setAutopayEnabled] = useState(false);
  const [autopayMethodId, setAutopayMethodId] = useState<string | null>(null);
  const [autopayBusy, setAutopayBusy] = useState(false);

  const loadMethods = useCallback(async () => {
    try {
      const data = await portalApi.stripe.paymentMethods();
      setMethods(data);
    } catch {
      // Stripe not configured or no customer yet
    } finally {
      setLoading(false);
    }
  }, []);

  const loadAutopay = useCallback(async () => {
    try {
      const data = await portalApi.stripe.getAutopay();
      setAutopayEnabled(data.enabled);
      setAutopayMethodId(data.paymentMethodId);
    } catch { /* not critical */ }
  }, []);

  useEffect(() => { loadMethods(); loadAutopay(); }, [loadMethods, loadAutopay]);

  const handleLinkBank = async () => {
    setLinking(true);
    try {
      const stripe = await getStripeJs();
      if (!stripe) { showToast('Online payments are not available right now.', 'error'); return; }

      const { clientSecret } = await portalApi.stripe.createSetupIntent();

      const { error } = await stripe.collectBankAccountForSetup({
        clientSecret,
        params: {
          payment_method_type: 'us_bank_account',
          payment_method_data: { billing_details: { name: tenantName } },
        },
      });

      if (error) {
        if (error.type !== 'validation_error') showToast(error.message || 'Could not link your bank account.', 'error');
        return;
      }

      const { error: confirmError } = await stripe.confirmUsBankAccountSetup(clientSecret);
      if (confirmError) {
        showToast(confirmError.message || 'Bank account verification failed.', 'error');
        return;
      }

      showToast('Bank account linked successfully.', 'success');
      await loadMethods();
    } catch (err) {
      showToast((err as Error).message || 'Could not link your bank account.', 'error');
    } finally {
      setLinking(false);
    }
  };

  const handleRemoveMethod = async (pmId: string) => {
    try {
      await portalApi.stripe.removePaymentMethod(pmId);
      setMethods(prev => prev.filter(m => m.id !== pmId));
      if (autopayMethodId === pmId) {
        await portalApi.stripe.setAutopay({ enabled: false });
        setAutopayEnabled(false);
        setAutopayMethodId(null);
      }
      showToast('Bank account removed.', 'success');
    } catch (err) {
      showToast((err as Error).message || 'Could not remove bank account.', 'error');
    }
  };

  const handlePayRent = async (pmId: string) => {
    const payAmount = status === 'partial' ? balance : amount;
    if (payAmount <= 0) return;

    setPaying(true);
    setPayResult(null);
    try {
      const result = await portalApi.stripe.payRent({
        paymentMethodId: pmId,
        amount: payAmount,
        month,
        year,
        leaseId,
      });

      if (result.status === 'requires_action' || result.status === 'requires_confirmation') {
        const stripe = await getStripeJs();
        if (stripe && result.clientSecret) {
          await stripe.confirmUsBankAccountPayment(result.clientSecret);
        }
      }

      setPayResult('processing');
      showToast('Payment submitted. ACH transfers typically take 3 to 5 business days.', 'success');
      onPaymentStarted?.();
    } catch (err) {
      setPayResult('failed');
      showToast((err as Error).message || 'Payment failed.', 'error');
    } finally {
      setPaying(false);
    }
  };

  const handleToggleAutopay = async (pmId: string) => {
    setAutopayBusy(true);
    try {
      if (autopayEnabled && autopayMethodId === pmId) {
        await portalApi.stripe.setAutopay({ enabled: false });
        setAutopayEnabled(false);
        setAutopayMethodId(null);
        showToast('Autopay turned off.', 'success');
      } else {
        await portalApi.stripe.setAutopay({ enabled: true, paymentMethodId: pmId });
        setAutopayEnabled(true);
        setAutopayMethodId(pmId);
        showToast('Autopay is on. Your rent will be charged automatically on the due date.', 'success');
      }
    } catch (err) {
      showToast((err as Error).message || 'Could not update autopay.', 'error');
    } finally {
      setAutopayBusy(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="p-5 flex items-center gap-3">
          <Loader2 className="h-4 w-4 animate-spin text-faint" />
          <span className="text-sm text-muted">Loading payment options...</span>
        </CardContent>
      </Card>
    );
  }

  const isPaid = status === 'paid';
  const payAmount = status === 'partial' ? balance : amount;
  const fee = achFee(payAmount);
  const totalWithFee = payAmount + fee;

  return (
    <Card id="pay-rent-online">
      <CardContent className="p-5 space-y-4">
        <p className="eyebrow">Pay rent online</p>

        {methods.length > 0 ? (
          <div className="space-y-3">
            {methods.map(pm => {
              const isAutopayMethod = autopayEnabled && autopayMethodId === pm.id;
              return (
                <div key={pm.id} className="rounded-xl border border-line bg-canvas p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="w-10 h-10 rounded-lg bg-primary-soft text-primary grid place-items-center flex-shrink-0">
                        <Building2 className="h-5 w-5" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-ink truncate">{pm.bankName}</p>
                        <p className="text-xs text-muted">····{pm.last4} · {pm.accountType}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {!isPaid && !payResult && (
                        <Button
                          size="sm"
                          disabled={paying}
                          onClick={() => handlePayRent(pm.id)}
                        >
                          {paying ? (
                            <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> Paying...</>
                          ) : (
                            <>Pay {formatCurrency(totalWithFee)}</>
                          )}
                        </Button>
                      )}
                      <button
                        onClick={() => handleRemoveMethod(pm.id)}
                        className="text-faint hover:text-danger p-1.5 rounded-lg hover:bg-danger-soft transition"
                        title="Remove bank account"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {/* Fee breakdown */}
                  {!isPaid && !payResult && (
                    <div className="text-xs text-muted pl-[52px]">
                      {formatCurrency(payAmount)} rent + {formatCurrency(fee)} processing fee
                    </div>
                  )}

                  {/* Autopay toggle */}
                  <div className="flex items-center justify-between pl-[52px]">
                    <div className="flex items-center gap-2">
                      <RefreshCw className={`h-3.5 w-3.5 ${isAutopayMethod ? 'text-primary' : 'text-faint'}`} />
                      <span className="text-xs font-medium text-ink">
                        {isAutopayMethod ? 'Autopay is on' : 'Autopay'}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleToggleAutopay(pm.id)}
                      disabled={autopayBusy}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition ${isAutopayMethod ? 'bg-primary' : 'bg-muted/30'} ${autopayBusy ? 'opacity-50' : ''}`}
                    >
                      <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${isAutopayMethod ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
                    </button>
                  </div>
                  {isAutopayMethod && (
                    <p className="text-xs text-muted pl-[52px]">
                      Rent will be charged automatically on the due date each month. A {formatCurrency(fee)} processing fee applies.
                    </p>
                  )}
                </div>
              );
            })}

            {payResult === 'processing' && (
              <div className="flex items-center gap-2.5 rounded-xl border border-primary/30 bg-primary-soft p-4">
                <CheckCircle className="h-5 w-5 text-primary flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-ink">Payment processing</p>
                  <p className="text-xs text-muted mt-0.5">ACH transfers typically take 3 to 5 business days to settle.</p>
                </div>
              </div>
            )}

            {payResult === 'failed' && (
              <div className="flex items-center gap-2.5 rounded-xl border border-danger/30 bg-danger-soft p-4">
                <AlertCircle className="h-5 w-5 text-danger flex-shrink-0" />
                <p className="text-sm text-ink">Payment failed. Please try again or use a different payment method.</p>
              </div>
            )}

            {isPaid && (
              <p className="text-sm text-muted flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-primary" /> {monthLabel} rent is paid. Nothing due.
              </p>
            )}
          </div>
        ) : (
          <div className="text-center py-3">
            <CreditCard className="h-8 w-8 text-faint mx-auto mb-2" />
            <p className="text-sm text-muted mb-3">Link your bank account to pay rent online.</p>
            <Button onClick={handleLinkBank} disabled={linking}>
              {linking ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> Connecting...</>
              ) : (
                'Link bank account'
              )}
            </Button>
          </div>
        )}

        {methods.length > 0 && (
          <button
            onClick={handleLinkBank}
            disabled={linking}
            className="text-sm text-primary hover:underline disabled:opacity-50"
          >
            {linking ? 'Connecting...' : '+ Link another bank account'}
          </button>
        )}
      </CardContent>
    </Card>
  );
}
