import { useState } from 'react';
import { Send } from 'lucide-react';
import { Card, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { TextInput, TextareaInput } from '../components/ui/FormField';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { useToast } from '../context/ToastContext';
import { remindersApi } from '../lib/api';

export function Reminders() {
  const { showToast } = useToast();
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const canSend = subject.trim().length > 0 && message.trim().length > 0 && !sending;

  async function handleSend() {
    setConfirmOpen(false);
    setSending(true);
    try {
      const res = await remindersApi.sendToAll(subject.trim(), message.trim());
      showToast(
        `Reminder sent to ${res.recipientCount} tenant${res.recipientCount === 1 ? '' : 's'}.`,
        'success'
      );
      setSubject('');
      setMessage('');
    } catch (err) {
      showToast((err as Error).message || 'Failed to send reminder', 'error');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
        Tenant communications
      </div>
      <h1 className="text-3xl font-bold text-ink mb-2">Reminders</h1>
      <p className="text-sm text-muted mb-6">
        Send a reminder by email and push notification to every active tenant. Use it for rent
        reminders, office notices, or anything the whole building should hear.
      </p>

      <Card>
        <CardContent className="space-y-4 p-6">
          <TextInput
            label="Subject"
            value={subject}
            maxLength={120}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="e.g. Friendly rent reminder"
          />
          <TextareaInput
            label="Message"
            value={message}
            rows={7}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Write your reminder here. Plain text is fine."
          />
          <div className="flex items-center justify-between pt-2">
            <p className="text-xs text-muted">
              Goes to all active tenants with an email or portal account.
            </p>
            <Button onClick={() => setConfirmOpen(true)} disabled={!canSend}>
              <Send className="w-4 h-4 mr-1.5" />
              {sending ? 'Sending…' : 'Send to all tenants'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <ConfirmDialog
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleSend}
        title="Send reminder to all tenants?"
        message={`This emails and push-notifies every active tenant with the subject "${subject.trim()}". This cannot be undone.`}
        confirmText="Send reminder"
      />
    </div>
  );
}
