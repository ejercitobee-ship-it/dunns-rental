import { useCallback, useEffect, useState } from 'react';
import { CreditCard, Building2, Trash2, Loader2, CheckCircle, AlertCircle, RefreshCw, DollarSign, Copy } from 'lucide-react';
import { Button } from '../ui/Button';
import { Card, CardContent } from '../ui/Card';
import { portalApi, type StripePaymentMethod } from '../../lib/api';
import { getStripeJs } from '../../lib/stripe';
import { formatCurrency } from '../../lib/utils';
import { useToast } from '../../context/ToastContext';

function achFee(amount: number): number {
  return Math.min(Math.round(amount * 0.008 * 100) / 100, 5);
}

function cardFee(amount: number): number {
  return Math.round((amount * 0.029 + 0.30) * 100) / 100;
}

function feeForMethod(amount: number, type: 'us_bank_account' | 'card'): number {
  return type === 'card' ? cardFee(amount) : achFee(amount);
}

function feeLabel(type: 'us_bank_account' | 'card'): string {
  return type === 'card' ? '2.9% + $0.30 card fee' : '0.8% ACH fee (max $5)';
}

const BRAND_LABELS: Record<string, string> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  amex: 'Amex',
  discover: 'Discover',
  diners: 'Diners',
  jcb: 'JCB',
  unionpay: 'UnionPay',
};

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
  paymentInstructions?: string;
  paymentMemo?: string;
}

export function PayRent({ leaseId, amount, month, year, monthLabel, status, balance, tenantName, onPaymentStarted, paymentInstructions, paymentMemo }: PayRentProps) {
  const { showToast } = useToast();
  const [methods, setMethods] = useState<StripePaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [linking, setLinking] = useState<'bank' | 'card' | null>(null);
  const [paying, setPaying] = useState(false);
  const [payResult, setPayResult] = useState<'processing' | 'failed' | null>(null);

  const [cardInputReady, setCardInputReady] = useState(false);
  const [cardClientSecret, setCardClientSecret] = useState<string | null>(null);

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
    setLinking('bank');
    try {
      const stripe = await getStripeJs();
      if (!stripe) { showToast('Online payments are not available right now.', 'error'); return; }

      const { clientSecret } = await portalApi.stripe.createSetupIntent('us_bank_account');

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
      setLinking(null);
    }
  };

  const handleAddCard = async () => {
    setLinking('card');
    try {
      const stripe = await getStripeJs();
      if (!stripe) { showToast('Online payments are not available right now.', 'error'); setLinking(null); return; }

      const { clientSecret } = await portalApi.stripe.createSetupIntent('card');
      await createCardElement(stripe);
      setCardClientSecret(clientSecret);
      setCardInputReady(true);
    } catch (err) {
      showToast((err as Error).message || 'Could not add your card.', 'error');
      setLinking(null);
      cleanupCardElement();
    }
  };

  const handleConfirmCard = async () => {
    if (!cardClientSecret || !_cardElement) return;
    setLinking('card');
    try {
      const stripe = await getStripeJs();
      if (!stripe) return;

      const { error } = await stripe.confirmCardSetup(cardClientSecret, {
        payment_method: {
          card: _cardElement,
          billing_details: { name: tenantName },
        },
      });

      if (error) {
        showToast(error.message || 'Could not add your card.', 'error');
        return;
      }

      showToast('Card added successfully.', 'success');
      await loadMethods();
    } catch (err) {
      showToast((err as Error).message || 'Could not add your card.', 'error');
    } finally {
      setLinking(null);
      setCardInputReady(false);
      setCardClientSecret(null);
      cleanupCardElement();
    }
  };

  const handleCancelCard = () => {
    setLinking(null);
    setCardInputReady(false);
    setCardClientSecret(null);
    cleanupCardElement();
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
      showToast('Payment method removed.', 'success');
    } catch (err) {
      showToast((err as Error).message || 'Could not remove payment method.', 'error');
    }
  };

  const handlePayRent = async (pm: StripePaymentMethod) => {
    const payAmount = status === 'partial' ? balance : amount;
    if (payAmount <= 0) return;

    setPaying(true);
    setPayResult(null);
    try {
      const result = await portalApi.stripe.payRent({
        paymentMethodId: pm.id,
        amount: payAmount,
        month,
        year,
        leaseId,
        methodType: pm.type,
      });

      if (pm.type === 'us_bank_account') {
        if (result.status === 'requires_action' || result.status === 'requires_confirmation') {
          const stripe = await getStripeJs();
          if (stripe && result.clientSecret) {
            await stripe.confirmUsBankAccountPayment(result.clientSecret);
          }
        }
        setPayResult('processing');
        showToast('Payment submitted. ACH transfers typically take 3 to 5 business days.', 'success');
      } else {
        if (result.status === 'requires_action') {
          const stripe = await getStripeJs();
          if (stripe && result.clientSecret) {
            const { error } = await stripe.confirmCardPayment(result.clientSecret);
            if (error) {
              setPayResult('failed');
              showToast(error.message || 'Card payment failed.', 'error');
              return;
            }
          }
        }
        setPayResult('processing');
        showToast('Card payment submitted. It should confirm within a few seconds.', 'success');
      }
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

  const bankMethods = methods.filter(m => m.type === 'us_bank_account');
  const cardMethods = methods.filter(m => m.type === 'card');

  return (
    <Card id="pay-rent-online">
      <CardContent className="p-5 space-y-4">
        <p className="eyebrow">Pay rent</p>

        {/* Card element mount point for adding a card */}
        <div id="stripe-card-element" className="hidden" />
        {cardInputReady && (
          <div className="flex gap-2">
            <Button onClick={handleConfirmCard} disabled={linking === 'card'}>
              {linking === 'card' ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> Saving...</>
              ) : (
                'Save card'
              )}
            </Button>
            <Button variant="secondary" onClick={handleCancelCard} disabled={linking === 'card'}>
              Cancel
            </Button>
          </div>
        )}

        {methods.length > 0 ? (
          <div className="space-y-3">
            {/* Bank accounts */}
            {bankMethods.map(pm => (
              <PaymentMethodRow
                key={pm.id}
                pm={pm}
                payAmount={payAmount}
                isPaid={isPaid}
                payResult={payResult}
                paying={paying}
                autopayEnabled={autopayEnabled}
                autopayMethodId={autopayMethodId}
                autopayBusy={autopayBusy}
                onPay={() => handlePayRent(pm)}
                onRemove={() => handleRemoveMethod(pm.id)}
                onToggleAutopay={() => handleToggleAutopay(pm.id)}
              />
            ))}

            {/* Cards */}
            {cardMethods.map(pm => (
              <PaymentMethodRow
                key={pm.id}
                pm={pm}
                payAmount={payAmount}
                isPaid={isPaid}
                payResult={payResult}
                paying={paying}
                autopayEnabled={autopayEnabled}
                autopayMethodId={autopayMethodId}
                autopayBusy={autopayBusy}
                onPay={() => handlePayRent(pm)}
                onRemove={() => handleRemoveMethod(pm.id)}
                onToggleAutopay={() => handleToggleAutopay(pm.id)}
              />
            ))}

            {payResult === 'processing' && (
              <div className="flex items-center gap-2.5 rounded-xl border border-primary/30 bg-primary-soft p-4">
                <CheckCircle className="h-5 w-5 text-primary flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-ink">Payment processing</p>
                  <p className="text-xs text-muted mt-0.5">
                    Your payment has been submitted and is being processed.
                  </p>
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
            <p className="text-sm text-muted mb-3">Add a payment method to pay rent online.</p>
            <div className="flex flex-col sm:flex-row gap-2 justify-center">
              <Button onClick={handleLinkBank} disabled={!!linking}>
                {linking === 'bank' ? (
                  <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> Connecting...</>
                ) : (
                  <><Building2 className="h-3.5 w-3.5 mr-1" /> Link bank account</>
                )}
              </Button>
              <Button variant="secondary" onClick={handleAddCard} disabled={!!linking}>
                {linking === 'card' ? (
                  <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> Adding...</>
                ) : (
                  <><CreditCard className="h-3.5 w-3.5 mr-1" /> Add card</>
                )}
              </Button>
            </div>
          </div>
        )}

        {methods.length > 0 && (
          <div className="flex flex-wrap gap-3">
            <button
              onClick={handleLinkBank}
              disabled={!!linking}
              className="text-sm text-primary hover:underline disabled:opacity-50"
            >
              {linking === 'bank' ? 'Connecting...' : '+ Link bank account'}
            </button>
            <button
              onClick={handleAddCard}
              disabled={!!linking}
              className="text-sm text-primary hover:underline disabled:opacity-50"
            >
              {linking === 'card' ? 'Adding...' : '+ Add card'}
            </button>
          </div>
        )}

        {paymentInstructions && (
          <ZelleOption instructions={paymentInstructions} memo={paymentMemo} />
        )}
      </CardContent>
    </Card>
  );
}

function PaymentMethodRow({
  pm,
  payAmount,
  isPaid,
  payResult,
  paying,
  autopayEnabled,
  autopayMethodId,
  autopayBusy,
  onPay,
  onRemove,
  onToggleAutopay,
}: {
  pm: StripePaymentMethod;
  payAmount: number;
  isPaid: boolean;
  payResult: 'processing' | 'failed' | null;
  paying: boolean;
  autopayEnabled: boolean;
  autopayMethodId: string | null;
  autopayBusy: boolean;
  onPay: () => void;
  onRemove: () => void;
  onToggleAutopay: () => void;
}) {
  const isAutopayMethod = autopayEnabled && autopayMethodId === pm.id;
  const fee = feeForMethod(payAmount, pm.type);
  const totalWithFee = payAmount + fee;

  const isCard = pm.type === 'card';
  const Icon = isCard ? CreditCard : Building2;
  const label = isCard
    ? `${BRAND_LABELS[pm.brand || ''] || 'Card'}`
    : (pm.bankName || 'Bank account');
  const sublabel = isCard
    ? `····${pm.last4}${pm.expMonth ? ` · ${String(pm.expMonth).padStart(2, '0')}/${String(pm.expYear).slice(-2)}` : ''}`
    : `····${pm.last4} · ${pm.accountType || 'checking'}`;

  return (
    <div className="rounded-xl border border-line bg-canvas p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="w-10 h-10 rounded-lg bg-primary-soft text-primary grid place-items-center flex-shrink-0">
            <Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink truncate">{label}</p>
            <p className="text-xs text-muted">{sublabel}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {!isPaid && !payResult && (
            <Button
              size="sm"
              disabled={paying}
              onClick={onPay}
            >
              {paying ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> Paying...</>
              ) : (
                <>Pay {formatCurrency(totalWithFee)}</>
              )}
            </Button>
          )}
          <button
            onClick={onRemove}
            className="text-faint hover:text-danger p-1.5 rounded-lg hover:bg-danger-soft transition"
            title="Remove payment method"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {!isPaid && !payResult && (
        <div className="text-xs text-muted pl-[52px]">
          {formatCurrency(payAmount)} rent + {formatCurrency(fee)} {feeLabel(pm.type)}
        </div>
      )}

      <div className="flex items-center justify-between pl-[52px]">
        <div className="flex items-center gap-2">
          <RefreshCw className={`h-3.5 w-3.5 ${isAutopayMethod ? 'text-primary' : 'text-faint'}`} />
          <span className="text-xs font-medium text-ink">
            {isAutopayMethod ? 'Autopay is on' : 'Autopay'}
          </span>
        </div>
        <button
          type="button"
          onClick={onToggleAutopay}
          disabled={autopayBusy}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition ${isAutopayMethod ? 'bg-primary' : 'bg-muted/30'} ${autopayBusy ? 'opacity-50' : ''}`}
        >
          <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${isAutopayMethod ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
        </button>
      </div>
      {isAutopayMethod && (
        <p className="text-xs text-muted pl-[52px]">
          Rent will be charged automatically on the due date each month. A {formatCurrency(fee)} {feeLabel(pm.type)} applies.
        </p>
      )}
    </div>
  );
}

function ZelleOption({ instructions, memo }: { instructions: string; memo?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!memo) return;
    try {
      await navigator.clipboard.writeText(memo);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {}
  };

  return (
    <div className="rounded-xl border border-line bg-canvas p-4 space-y-3">
      <div className="flex items-center gap-3">
        <span className="w-10 h-10 rounded-lg bg-[#6d1ed4]/10 text-[#6d1ed4] grid place-items-center flex-shrink-0">
          <DollarSign className="h-5 w-5" />
        </span>
        <div>
          <p className="text-sm font-semibold text-ink">Zelle</p>
          <p className="text-xs text-muted">No processing fee</p>
        </div>
      </div>
      <p className="text-sm text-ink pl-[52px]">{instructions}</p>
      {memo && (
        <div className="ml-[52px] rounded-lg border border-line bg-surface p-3 space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Put this in the memo</p>
          <div className="flex items-center gap-2">
            <code className="text-sm text-ink flex-1 break-words">{memo}</code>
            <button
              type="button"
              onClick={copy}
              className="flex items-center gap-1 text-xs text-primary hover:underline flex-shrink-0"
            >
              <Copy className="h-3 w-3" />
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

let _cardElement: any = null;

async function createCardElement(stripe: any): Promise<any> {
  cleanupCardElement();
  const elements = stripe.elements();
  _cardElement = elements.create('card', {
    style: {
      base: {
        fontSize: '16px',
        color: 'var(--color-ink, #1a1a1a)',
        '::placeholder': { color: 'var(--color-muted, #999)' },
      },
    },
  });
  const container = document.getElementById('stripe-card-element');
  if (container) {
    container.classList.remove('hidden');
    container.classList.add('rounded-xl', 'border', 'border-line', 'bg-canvas', 'p-4', 'mb-3');
    _cardElement.mount(container);
  }
  await new Promise<void>((resolve) => {
    _cardElement.on('ready', () => resolve());
  });
  return _cardElement;
}

function cleanupCardElement() {
  if (_cardElement) {
    try { _cardElement.unmount(); } catch {}
    _cardElement = null;
  }
  const container = document.getElementById('stripe-card-element');
  if (container) {
    container.classList.add('hidden');
    container.classList.remove('rounded-xl', 'border', 'border-line', 'bg-canvas', 'p-4', 'mb-3');
  }
}
