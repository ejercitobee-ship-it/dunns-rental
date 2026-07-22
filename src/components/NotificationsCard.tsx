import { useEffect, useState } from 'react';
import { Bell, BellRing } from 'lucide-react';
import { Card, CardContent } from './ui/Card';
import { Button } from './ui/Button';
import { useToast } from '../context/ToastContext';
import { portalApi } from '../lib/api';
import { getPushState, enablePush, disablePush, type PushState } from '../lib/push';

/** Lets a tenant turn on push notifications for rent and maintenance updates.
 * Adapts to what their device supports; on iPhone, notifications only work once
 * the app is added to the home screen, so it guides them to do that first. */
export function NotificationsCard() {
  const { showToast } = useToast();
  const [state, setState] = useState<PushState | 'loading'>('loading');
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    getPushState()
      .then(setState)
      .catch(() => setState('unsupported'));
  };

  useEffect(() => {
    refresh();
  }, []);

  const turnOn = () => {
    setBusy(true);
    enablePush()
      .then(() => {
        showToast('Notifications are on for this device.', 'success');
        refresh();
      })
      .catch((err) => showToast((err as Error).message || 'Could not turn on notifications.', 'error'))
      .finally(() => setBusy(false));
  };

  const turnOff = () => {
    setBusy(true);
    disablePush()
      .then(() => {
        showToast('Notifications turned off on this device.', 'success');
        refresh();
      })
      .catch(() => showToast('Could not turn off notifications.', 'error'))
      .finally(() => setBusy(false));
  };

  const sendTest = () => {
    setBusy(true);
    portalApi
      .pushTest()
      .then(() => showToast('Test sent. It should arrive shortly.', 'success'))
      .catch(() => showToast('Could not send the test.', 'error'))
      .finally(() => setBusy(false));
  };

  if (state === 'loading') return null;

  // On a phone that has not installed the app (mainly iPhone Safari), push is
  // not available yet. Nudge them to add it to the home screen.
  if (state === 'unsupported') {
    return (
      <Card>
        <CardContent className="p-5 flex items-start gap-3">
          <Bell className="h-5 w-5 text-faint flex-shrink-0 mt-0.5" />
          <p className="text-sm text-muted">
            Want alerts for rent and maintenance on your phone? Add this app to your home screen first, then open it from
            there to turn on notifications.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            {state === 'on' ? (
              <BellRing className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
            ) : (
              <Bell className="h-5 w-5 text-faint flex-shrink-0 mt-0.5" />
            )}
            <div className="min-w-0">
              <p className="font-medium text-ink">Notifications</p>
              <p className="text-sm text-muted mt-0.5">
                {state === 'on'
                  ? 'You will get alerts on this device for rent and maintenance updates.'
                  : state === 'denied'
                  ? 'Notifications are blocked. Turn them on for this site in your browser settings, then reload.'
                  : 'Get alerts on this device for rent reminders and maintenance updates.'}
              </p>
            </div>
          </div>
          {state === 'off' && (
            <Button onClick={turnOn} disabled={busy} className="flex-shrink-0">Turn on</Button>
          )}
        </div>

        {state === 'on' && (
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={sendTest} disabled={busy}>Send a test</Button>
            <Button variant="secondary" onClick={turnOff} disabled={busy}>Turn off</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
