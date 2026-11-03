import { useState } from 'react';
import { Send } from 'lucide-react';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { formatCurrency, formatMonthYear } from '../lib/utils';
import { EmailInput } from './ui/EmailInput';
import { paymentsApi } from '../lib/api';
import { useToast } from '../context/ToastContext';
import { SelectInput, TextareaInput } from './ui/FormField';

interface SendPaymentLinkModalProps {
  isOpen: boolean;
  onClose: () => void;
  tenantName: string;
  tenantEmail: string;
  tenantId: string;
  leaseId: string;
  owedMonths: { month: number; year: number; amount: number }[];
  onSent?: () => void;
}

export function SendPaymentLinkModal({
  isOpen, onClose, tenantName, tenantEmail, tenantId, leaseId, owedMonths, onSent,
}: SendPaymentLinkModalProps) {
  const { showToast } = useToast();

  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();

  const defaultMonth = owedMonths.length > 0 ? owedMonths[0] : { month: currentMonth, year: currentYear, amount: 0 };

  const [selectedMonth, setSelectedMonth] = useState(defaultMonth.month);
  const [selectedYear, setSelectedYear] = useState(defaultMonth.year);
  const [amount, setAmount] = useState(defaultMonth.amount > 0 ? defaultMonth.amount.toFixed(2) : '');
  const [email, setEmail] = useState(tenantEmail);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);

  const parsedAmount = parseFloat(amount) || 0;
  const cardFee = parsedAmount > 0 ? Math.round(((parsedAmount * 0.029 + 0.30) / (1 - 0.029)) * 100) / 100 : 0;
  const achFee = parsedAmount > 0 ? Math.min(Math.round(((parsedAmount * 0.008) / (1 - 0.008)) * 100) / 100, 5) : 0;

  const handleMonthChange = (value: string) => {
    const [m, y] = value.split('-').map(Number);
    setSelectedMonth(m);
    setSelectedYear(y);
    const match = owedMonths.find(o => o.month === m && o.year === y);
    if (match) setAmount(match.amount.toFixed(2));
  };

  const handleSend = async () => {
    if (parsedAmount <= 0) {
      showToast('Enter a valid amount', 'error');
      return;
    }
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !trimmedEmail.includes('@')) {
      showToast('Enter a valid email address', 'error');
      return;
    }
    setSending(true);
    try {
      const res = await paymentsApi.sendPaymentLink({
        tenantId,
        leaseId,
        amount: parsedAmount,
        month: selectedMonth,
        year: selectedYear,
        note: note.trim() || undefined,
        email: trimmedEmail !== tenantEmail ? trimmedEmail : undefined,
      });
      showToast(`Payment link sent to ${res.email}`, 'success');
      onSent?.();
      onClose();
    } catch (err) {
      showToast((err as Error).message || 'Failed to send payment link', 'error');
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={() => !sending && onClose()} title="Send payment link" size="sm">
      <div className="space-y-4">
        <p className="text-sm text-muted">
          Send {tenantName} a secure Stripe checkout link by email. The tenant can pay by card (2.9% + $0.30 fee) or bank transfer (0.8%, max $5).
        </p>

        <div>
          <label className="block text-sm font-medium text-ink mb-1.5">Send to email</label>
          <EmailInput
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
            placeholder="recipient@example.com"
          />
          {email.trim() && email.trim() !== tenantEmail && (
            <p className="text-xs text-muted mt-1">Sending to a different address than the tenant's email on file.</p>
          )}
        </div>

        <SelectInput label="Month" name="paymentMonth"
          value={`${selectedMonth}-${selectedYear}`} onChange={(e) => handleMonthChange(e.target.value)}>
          {owedMonths.length > 0 ? (
            owedMonths.map(m => (
              <option key={`${m.month}-${m.year}`} value={`${m.month}-${m.year}`}>
                {formatMonthYear(m.month, m.year)} ({formatCurrency(m.amount)} owed)
              </option>
            ))
          ) : (
            <option value={`${currentMonth}-${currentYear}`}>
              {formatMonthYear(currentMonth, currentYear)}
            </option>
          )}
        </SelectInput>

        <div>
          <label className="block text-sm font-medium text-ink mb-1.5">Rent amount</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">$</span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full rounded-lg border border-line bg-surface pl-7 pr-3 py-2 text-sm text-ink"
              placeholder="0.00"
            />
          </div>
        </div>

        {parsedAmount > 0 && (
          <div className="rounded-lg bg-canvas border border-line p-3 space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted">Rent</span>
              <span className="text-ink">{formatCurrency(parsedAmount)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Card fee</span>
              <span className="text-ink">+{formatCurrency(cardFee)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Bank transfer fee</span>
              <span className="text-ink">+{formatCurrency(achFee)}</span>
            </div>
            <p className="text-xs text-muted pt-1 border-t border-line">
              Fee depends on payment method chosen at checkout. Paid by the tenant.
            </p>
          </div>
        )}

        <TextareaInput label="Note (optional)" name="paymentNote" rows={2}
          value={note} onChange={(e) => setNote(e.target.value)}
          className="resize-none" placeholder="Add a note to the email..." />

        <Button onClick={handleSend} disabled={sending || parsedAmount <= 0} className="w-full">
          <Send className="h-4 w-4 mr-2" />
          {sending ? 'Sending...' : `Send link for ${parsedAmount > 0 ? formatCurrency(parsedAmount) : '$0.00'}`}
        </Button>
      </div>
    </Modal>
  );
}
