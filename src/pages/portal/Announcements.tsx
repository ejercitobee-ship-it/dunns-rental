import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Megaphone } from 'lucide-react';
import { Card, CardContent } from '../../components/ui/Card';
import { Skeleton } from '../../components/ui/Skeleton';
import { portalApi, type PortalAnnouncement } from '../../lib/api';

export function Announcements() {
  const [announcements, setAnnouncements] = useState<PortalAnnouncement[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    portalApi.announcements()
      .then(setAnnouncements)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-32 w-full rounded-2xl" />
        <Skeleton className="h-32 w-full rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Link
          to="/portal"
          className="w-9 h-9 rounded-xl bg-surface border border-line grid place-items-center text-muted hover:text-ink hover:border-line-strong transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="font-display text-[22px] text-ink">Announcements</h1>
      </div>

      {announcements.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center">
            <Megaphone className="h-10 w-10 mx-auto text-muted mb-3" />
            <p className="text-sm text-muted">No announcements right now. Check back later.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {announcements.map(a => (
            <Card key={a.id}>
              <CardContent className="p-5 space-y-3">
                <div className="flex items-start gap-3">
                  <span className="w-9 h-9 rounded-xl bg-primary-soft text-primary grid place-items-center flex-shrink-0 mt-0.5">
                    <Megaphone className="h-[18px] w-[18px]" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2 className="font-semibold text-ink text-[15px] leading-snug">{a.title}</h2>
                    <p className="text-xs text-muted mt-1">
                      {new Date(a.created_at * 1000).toLocaleDateString(undefined, {
                        month: 'long', day: 'numeric', year: 'numeric',
                      })}
                      {a.property_name ? ` · ${a.property_name}` : ''}
                    </p>
                  </div>
                </div>
                <p className="text-sm text-muted whitespace-pre-line leading-relaxed pl-12">
                  {a.body}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
