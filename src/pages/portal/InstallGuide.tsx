import { Share, Plus, MoreVertical, Home, Check, Bell, Smartphone } from 'lucide-react';
import { Card, CardContent } from '../../components/ui/Card';

/** A rough platform guess, only to highlight the most relevant steps first. */
function guessPlatform(): 'ios' | 'android' | 'other' {
  const ua = navigator.userAgent || '';
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
  if (/android/i.test(ua)) return 'android';
  return 'other';
}

function Step({ n, icon, children }: { n: number; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="w-6 h-6 rounded-full bg-primary text-white text-xs font-bold grid place-items-center flex-shrink-0 mt-0.5">{n}</span>
      <span className="text-sm text-ink flex items-center gap-1.5 flex-wrap">{children}<span className="text-muted inline-flex">{icon}</span></span>
    </li>
  );
}

export function InstallGuide() {
  const platform = guessPlatform();

  const iosCard = (
    <Card key="ios">
      <CardContent className="p-5">
        <h3 className="font-semibold text-ink flex items-center gap-2 mb-3">
          <Smartphone className="h-4 w-4 text-faint" /> On an iPhone or iPad
        </h3>
        <ol className="space-y-3">
          <Step n={1} icon={null}>Open this page in <strong>Safari</strong> (not another browser).</Step>
          <Step n={2} icon={<Share className="h-4 w-4" />}>Tap the <strong>Share</strong> button at the bottom of the screen.</Step>
          <Step n={3} icon={<Plus className="h-4 w-4" />}>Scroll down and tap <strong>Add to Home Screen</strong>.</Step>
          <Step n={4} icon={<Check className="h-4 w-4" />}>Tap <strong>Add</strong> in the top corner. Done.</Step>
        </ol>
      </CardContent>
    </Card>
  );

  const androidCard = (
    <Card key="android">
      <CardContent className="p-5">
        <h3 className="font-semibold text-ink flex items-center gap-2 mb-3">
          <Smartphone className="h-4 w-4 text-faint" /> On an Android phone
        </h3>
        <ol className="space-y-3">
          <Step n={1} icon={null}>Open this page in <strong>Chrome</strong>.</Step>
          <Step n={2} icon={<MoreVertical className="h-4 w-4" />}>Tap the <strong>menu</strong> (three dots) in the top corner.</Step>
          <Step n={3} icon={<Home className="h-4 w-4" />}>Tap <strong>Add to Home screen</strong> (or <strong>Install app</strong>).</Step>
          <Step n={4} icon={<Check className="h-4 w-4" />}>Tap <strong>Add</strong> / <strong>Install</strong>. Done.</Step>
        </ol>
      </CardContent>
    </Card>
  );

  // Show the likely platform first.
  const cards = platform === 'android' ? [androidCard, iosCard] : [iosCard, androidCard];

  return (
    <div className="space-y-5">
      <div>
        <p className="eyebrow">Quick setup</p>
        <h1 className="font-display text-[26px] text-ink mt-1">Add the app to your phone</h1>
        <p className="text-sm text-muted mt-1">
          It takes about 20 seconds and adds an MH Dunn icon to your home screen, so you can open it with one tap.
        </p>
      </div>

      <Card>
        <CardContent className="p-5">
          <div className="flex items-start gap-3">
            <span className="w-9 h-9 rounded-xl bg-primary-soft text-primary grid place-items-center flex-shrink-0"><Bell className="h-[18px] w-[18px]" /></span>
            <p className="text-sm text-muted">
              Adding it also lets us send you reminders and messages as notifications. On iPhone especially,
              notifications only work once the app is on your home screen, so this step is worth doing.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">{cards}</div>

      <p className="text-xs text-muted text-center">
        Once it's on your home screen, open it from there and sign in as usual.
      </p>
    </div>
  );
}
