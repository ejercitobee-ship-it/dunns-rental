import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Megaphone } from 'lucide-react';
import { Card, CardContent } from '../../components/ui/Card';
import { Skeleton } from '../../components/ui/Skeleton';
import { portalApi, type PortalAnnouncement } from '../../lib/api';

function renderAnnouncementBody(body: string) {
  const lines = body.split('\n');
  const elements: React.ReactNode[] = [];
  let bulletBuffer: string[] = [];
  const flushBullets = () => {
    if (bulletBuffer.length === 0) return;
    elements.push(
      <ul key={`ul-${elements.length}`} className="space-y-1.5 my-2">
        {bulletBuffer.map((b, i) => (
          <li key={i} className="flex gap-2 text-sm text-muted leading-relaxed">
            <span className="text-primary mt-0.5 flex-shrink-0">&#8226;</span>
            <span>{renderInline(b)}</span>
          </li>
        ))}
      </ul>
    );
    bulletBuffer = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const bulletMatch = line.match(/^[-•]\s+(.+)/);
    const numMatch = line.match(/^(\d+)\.\s+(.+)/);
    if (bulletMatch) {
      bulletBuffer.push(bulletMatch[1]);
      continue;
    }
    flushBullets();
    if (numMatch) {
      elements.push(
        <div key={i} className="flex gap-2 text-sm text-muted leading-relaxed my-1">
          <span className="text-primary font-semibold flex-shrink-0 w-5 text-right">{numMatch[1]}.</span>
          <span>{renderInline(numMatch[2])}</span>
        </div>
      );
    } else if (line.trim() === '') {
      elements.push(<div key={i} className="h-2" />);
    } else {
      const isHeader = /\*\*(.+)\*\*:?$/.test(line.trim());
      if (isHeader) {
        elements.push(
          <p key={i} className="text-sm font-semibold text-ink mt-3 mb-1">{renderInline(line.trim())}</p>
        );
      } else {
        elements.push(
          <p key={i} className="text-sm text-muted leading-relaxed">{renderInline(line)}</p>
        );
      }
    }
  }
  flushBullets();
  return <div className="pl-12 space-y-0.5">{elements}</div>;
}

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    const bold = part.match(/^\*\*(.+)\*\*$/);
    if (bold) return <strong key={i} className="font-semibold text-ink">{bold[1]}</strong>;
    return <span key={i}>{part}</span>;
  });
}

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
                {renderAnnouncementBody(a.body)}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
