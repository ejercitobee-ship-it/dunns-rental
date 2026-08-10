import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Building2, Users, DollarSign, Receipt, FileText,
  Wrench, ClipboardList, ScrollText, MessageSquare, CalendarDays,
  Settings, Shield, Upload, Search, Megaphone,
} from 'lucide-react';
const ROUTES = [
  { name: 'Dashboard', path: '/', icon: LayoutDashboard, keywords: 'home overview stats' },
  { name: 'Properties', path: '/properties', icon: Building2, keywords: 'buildings units address' },
  { name: 'Tenants', path: '/tenants', icon: Users, keywords: 'people residents occupants' },
  { name: 'Messages', path: '/messages', icon: MessageSquare, keywords: 'chat inbox' },
  { name: 'Rent Management', path: '/rents', icon: DollarSign, keywords: 'payments money billing' },
  { name: 'Maintenance', path: '/maintenance', icon: Wrench, keywords: 'repairs handyman fix' },
  { name: 'Finances', path: '/finances', icon: Receipt, keywords: 'expenses income budget' },
  { name: 'Calendar', path: '/calendar', icon: CalendarDays, keywords: 'events schedule dates' },
  { name: 'Reports', path: '/reports', icon: ClipboardList, keywords: 'analytics data' },
  { name: 'Tax Report', path: '/tax-report', icon: FileText, keywords: 'taxes deductions depreciation' },
  { name: 'Data Migration', path: '/data-migration', icon: Upload, keywords: 'import csv' },
  { name: 'Settings', path: '/settings', icon: Settings, keywords: 'config preferences company' },
  { name: 'Users', path: '/users', icon: Shield, keywords: 'team members roles permissions' },
  { name: 'Activity', path: '/activity', icon: ScrollText, keywords: 'log audit history' },
  { name: 'Announcements', path: '/announcements', icon: Megaphone, keywords: 'broadcast notice tenants' },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  // Listen for Ctrl+K / Cmd+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(prev => !prev);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setQuery('');
      setSelected(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const results = useMemo(() => {
    if (!query.trim()) return ROUTES;
    const q = query.toLowerCase();
    return ROUTES.filter(r =>
      r.name.toLowerCase().includes(q) || r.keywords.includes(q)
    );
  }, [query]);

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected(s => Math.min(s + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected(s => Math.max(s - 1, 0));
    } else if (e.key === 'Enter' && results[selected]) {
      navigate(results[selected].path);
      setOpen(false);
    }
  };

  if (!open) return null;

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-ink/30 backdrop-blur-sm z-[60]"
        onClick={() => setOpen(false)}
      />

      {/* Palette */}
      <div className="fixed top-[15%] left-1/2 -translate-x-1/2 z-[61] w-full max-w-lg mx-auto px-4">
        <div className="bg-surface rounded-xl shadow-2xl border border-line overflow-hidden animate-in fade-in zoom-in-95 duration-150">
          {/* Search input */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-line">
            <Search className="h-4 w-4 text-muted flex-shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => { setQuery(e.target.value); setSelected(0); }}
              onKeyDown={handleKeyDown}
              placeholder="Go to..."
              className="flex-1 bg-transparent text-sm text-ink placeholder:text-faint outline-none"
            />
            <kbd className="hidden sm:inline-flex px-1.5 py-0.5 rounded border border-line bg-canvas text-[10px] text-muted font-mono">
              ESC
            </kbd>
          </div>

          {/* Results */}
          <div className="max-h-72 overflow-y-auto py-1">
            {results.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-muted">No matching pages.</div>
            ) : (
              results.map((route, i) => {
                const Icon = route.icon;
                return (
                  <button
                    key={route.path}
                    onClick={() => { navigate(route.path); setOpen(false); }}
                    onMouseEnter={() => setSelected(i)}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                      i === selected ? 'bg-primary-soft text-primary' : 'text-ink hover:bg-canvas'
                    }`}
                  >
                    <Icon className="h-4 w-4 flex-shrink-0" />
                    <span className="flex-1 text-left">{route.name}</span>
                    {i === selected && (
                      <span className="text-xs text-muted">↵ Enter</span>
                    )}
                  </button>
                );
              })
            )}
          </div>

          {/* Footer hint */}
          <div className="px-4 py-2 border-t border-line flex items-center gap-3 text-[11px] text-faint">
            <span>↑↓ Navigate</span>
            <span>↵ Open</span>
            <span>ESC Close</span>
          </div>
        </div>
      </div>
    </>
  );
}
