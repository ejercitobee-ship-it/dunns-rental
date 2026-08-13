import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { vendorFormApi, type VendorFormInfo } from '../lib/api';

const PAYMENT_METHODS = [
  { value: 'check', label: 'Check' },
  { value: 'zelle', label: 'Zelle' },
  { value: 'venmo', label: 'Venmo' },
  { value: 'cash', label: 'Cash' },
  { value: 'other', label: 'Other' },
];

export function VendorFormPage() {
  const { token } = useParams<{ token: string }>();
  const [info, setInfo] = useState<VendorFormInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const [form, setForm] = useState({
    vendorName: '',
    companyName: '',
    vendorEmail: '',
    vendorPhone: '',
    propertyId: '',
    unitId: '',
    workDescription: '',
    amount: '',
    paymentMethod: '',
  });

  useEffect(() => {
    if (!token) return;
    vendorFormApi.info(token)
      .then((data) => {
        setInfo(data);
        if (data.alreadySubmitted) {
          setSubmitted(true);
        } else {
          setForm(f => ({
            ...f,
            vendorName: data.vendorName || f.vendorName,
            companyName: data.companyName || f.companyName,
            vendorEmail: data.vendorEmail || f.vendorEmail,
            vendorPhone: data.vendorPhone || f.vendorPhone,
            propertyId: data.propertyId || f.propertyId,
            unitId: data.unitId || f.unitId,
            workDescription: data.workDescription || f.workDescription,
            amount: data.amount ? String(data.amount) : f.amount,
            paymentMethod: data.paymentMethod || f.paymentMethod,
          }));
        }
      })
      .catch(() => setError('This link is not valid or has expired.'))
      .finally(() => setLoading(false));
  }, [token]);

  const propertyUnits = useMemo(() => {
    if (!info?.units || !form.propertyId) return [];
    return info.units.filter(u => u.propertyId === form.propertyId);
  }, [info?.units, form.propertyId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || submitting) return;
    setSubmitError('');
    setSubmitting(true);

    try {
      await vendorFormApi.submit(token, {
        ...form,
        amount: parseFloat(form.amount),
      });
      setSubmitted(true);
    } catch (err) {
      setSubmitError((err as Error).message || 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <Shell>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-[#24503f]" />
        </div>
      </Shell>
    );
  }

  if (error) {
    return (
      <Shell>
        <div className="text-center py-16">
          <AlertCircle className="h-10 w-10 text-[#a23429] mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-[#1b1a17] mb-2">Link Not Valid</h2>
          <p className="text-[#75726a]">{error}</p>
        </div>
      </Shell>
    );
  }

  if (submitted) {
    const statusMessages: Record<string, string> = {
      submitted: 'Your invoice has been received and is under review. You will be notified by email when it is approved.',
      approved: 'Your invoice has been approved. Payment will be processed shortly.',
      paid: 'Your invoice has been paid. Thank you for your work.',
    };
    const statusMsg = statusMessages[info?.status || 'submitted'] || statusMessages.submitted;

    return (
      <Shell>
        <div className="text-center py-16">
          <CheckCircle className="h-12 w-12 text-[#2c7a58] mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-[#1b1a17] mb-2">Invoice Submitted</h2>
          <p className="text-[#75726a] max-w-md mx-auto">{statusMsg}</p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      {info?.jobTitle && (
        <div className="mb-6 p-4 rounded-xl bg-[#f2f5f2] border border-[#dfe7e1]">
          <p className="text-xs uppercase tracking-wider font-semibold text-[#75726a] mb-1">Job reference</p>
          <p className="font-medium text-[#1b1a17]">{info.jobTitle}</p>
          {info.propAddress && <p className="text-sm text-[#75726a] mt-0.5">{info.propAddress}</p>}
        </div>
      )}

      {info?.rejectionReason && (
        <div className="mb-6 p-4 rounded-xl bg-[#f6e8e6] border border-[#e8c8c4]">
          <p className="text-sm font-semibold text-[#a23429] mb-1">Revision requested</p>
          <p className="text-sm text-[#1b1a17]">{info.rejectionReason}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <h2 className="text-lg font-semibold text-[#1b1a17]">Your Information</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-[#1b1a17] mb-1.5">Your Name *</label>
            <input
              type="text"
              required
              value={form.vendorName}
              onChange={e => setForm(f => ({ ...f, vendorName: e.target.value }))}
              className="w-full border border-[#e7e4dd] rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#24503f]/25"
              placeholder="John Smith"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[#1b1a17] mb-1.5">Company Name</label>
            <input
              type="text"
              value={form.companyName}
              onChange={e => setForm(f => ({ ...f, companyName: e.target.value }))}
              className="w-full border border-[#e7e4dd] rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#24503f]/25"
              placeholder="Smith Plumbing LLC"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-[#1b1a17] mb-1.5">Email</label>
            <input
              type="email"
              value={form.vendorEmail}
              onChange={e => setForm(f => ({ ...f, vendorEmail: e.target.value }))}
              className="w-full border border-[#e7e4dd] rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#24503f]/25"
              placeholder="john@example.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[#1b1a17] mb-1.5">Phone</label>
            <input
              type="tel"
              value={form.vendorPhone}
              onChange={e => setForm(f => ({ ...f, vendorPhone: e.target.value }))}
              className="w-full border border-[#e7e4dd] rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#24503f]/25"
              placeholder="(312) 555-0100"
            />
          </div>
        </div>

        <div className="border-t border-[#e7e4dd] pt-5">
          <h2 className="text-lg font-semibold text-[#1b1a17] mb-4">Work Details</h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-[#1b1a17] mb-1.5">Property *</label>
            <select
              required
              value={form.propertyId}
              onChange={e => setForm(f => ({ ...f, propertyId: e.target.value, unitId: '' }))}
              className="w-full border border-[#e7e4dd] rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#24503f]/25"
            >
              <option value="">Select a property</option>
              {info?.properties.map(p => (
                <option key={p.id} value={p.id}>{p.name || p.address}</option>
              ))}
            </select>
          </div>
          {propertyUnits.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-[#1b1a17] mb-1.5">Unit</label>
              <select
                value={form.unitId}
                onChange={e => setForm(f => ({ ...f, unitId: e.target.value }))}
                className="w-full border border-[#e7e4dd] rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#24503f]/25"
              >
                <option value="">All units / common area</option>
                {propertyUnits.map(u => (
                  <option key={u.id} value={u.id}>Unit {u.unitNumber}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-[#1b1a17] mb-1.5">Work Description</label>
          <textarea
            value={form.workDescription}
            onChange={e => setForm(f => ({ ...f, workDescription: e.target.value }))}
            rows={3}
            className="w-full border border-[#e7e4dd] rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#24503f]/25"
            placeholder="Describe the work you performed"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-[#1b1a17] mb-1.5">Amount *</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#75726a] text-sm">$</span>
              <input
                type="number"
                required
                step="0.01"
                min="0.01"
                value={form.amount}
                onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                className="w-full border border-[#e7e4dd] rounded-lg pl-7 pr-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#24503f]/25"
                placeholder="0.00"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-[#1b1a17] mb-1.5">Payment Method *</label>
            <select
              required
              value={form.paymentMethod}
              onChange={e => setForm(f => ({ ...f, paymentMethod: e.target.value }))}
              className="w-full border border-[#e7e4dd] rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#24503f]/25"
            >
              <option value="">Select method</option>
              {PAYMENT_METHODS.map(m => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>
        </div>

        {submitError && (
          <div className="p-3 rounded-lg bg-[#f6e8e6] border border-[#e8c8c4] text-sm text-[#a23429]">
            {submitError}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full py-3 bg-[#24503f] text-white rounded-xl text-sm font-semibold hover:bg-[#1c4032] disabled:opacity-50 transition-colors"
        >
          {submitting ? 'Submitting...' : 'Submit Invoice'}
        </button>
      </form>
    </Shell>
  );
}

/** Minimal branded shell for the public form page (no sidebar, no login). */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f6f5f1]" style={{ fontFamily: "'Hanken Grotesk', system-ui, sans-serif" }}>
      <header className="bg-[#24503f] text-white px-6 py-5">
        <div className="max-w-xl mx-auto">
          <p className="font-semibold text-lg" style={{ fontFamily: "'Fraunces', Georgia, serif" }}>
            MH Dunn Property
          </p>
          <p className="text-sm text-white/70 mt-0.5">Vendor Invoice Form</p>
        </div>
      </header>
      <main className="max-w-xl mx-auto px-4 sm:px-6 py-8">
        <div className="bg-white rounded-2xl border border-[#e7e4dd] shadow-sm p-6 sm:p-8">
          {children}
        </div>
      </main>
      <footer className="text-center text-xs text-[#a6a29a] py-6">
        © {new Date().getFullYear()} MH Dunn Property
      </footer>
    </div>
  );
}
