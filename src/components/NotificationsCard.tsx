import { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { Card, CardContent } from './ui/Card';
import { getPushState, type PushState } from '../lib/push';

/**
 * Passive notice about notifications for tenants. Notifications are on by
 * default and enabled automatically (see useAutoEnablePush), so there is no
 * turn on / turn off control here. This only speaks up in the two cases the
 * tenant has to resolve on their own device: an iPhone that has not installed
 * the app to the home screen yet, or notifications they blocked in their phone
 * settings. When alerts are working, it shows nothing.
 */
export function NotificationsCard() {
  const [state, setState] = useState<PushState | 'loading'>('loading');

  useEffect(() => {
    let alive = true;
    getPushState()
      .then((s) => {
        if (alive) setState(s);
      })
      .catch(() => {
        if (alive) setState('unsupported');
      });
    return () => {
      alive = false;
    };
  }, []);

  // On a phone that has not installed the app (mainly iPhone Safari), push is
  // not available until it is added to the home screen.
  if (state === 'unsupported') {
    return (
      <Card>
        <CardContent className="p-5 flex items-start gap-3">
          <Bell className="h-5 w-5 text-faint flex-shrink-0 mt-0.5" />
          <p className="text-sm text-muted">
            To get alerts for rent and maintenance on your phone, add this app to your home screen, then open it from
            there.
          </p>
        </CardContent>
      </Card>
    );
  }

  // The tenant blocked notifications for this app; only their device settings
  // can turn them back on.
  if (state === 'denied') {
    return (
      <Card>
        <CardContent className="p-5 flex items-start gap-3">
          <Bell className="h-5 w-5 text-faint flex-shrink-0 mt-0.5" />
          <p className="text-sm text-muted">
            Notifications are turned off for this app in your device settings. Turn them back on there to get rent and
            maintenance alerts.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Working, or about to be enabled automatically: nothing for the tenant to do.
  return null;
}
