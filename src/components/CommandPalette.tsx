import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Building2, Users, DollarSign, Receipt, FileText,
  Wrench, ClipboardList, ScrollText, MessageSquare, CalendarDays,
  Settings, Shield, Upload, Search, Megaphone, User, Home, Bot,
  type LucideIcon,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useExitAnimation } from '../lib/useExitAnimation';

const ROUTES: { name: string; path: string; icon: LucideIcon; keywords: string }[] = [
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
  { name: 'AI Assistant', path: '/ai-assistant', icon: Bot, keywords: 'ai chat ask question intelligence' },
];

interface SearchResult {
  kind: 'page' | 'tenant' | 'property';
  label: string;
  sublabel?: string;
  path: string;
  icon: LucideIcon;
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { tenants, properties, units, leases } = useApp();
  const { mounted, phase } = useExitAnimation(open, 160);

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

  const results = useMemo<SearchResult[]>(() => {
    const q = query.trim().toLowerCase();

    // No query: show pages only (too many tenants/properties to list all).
    if (!q) {
      return ROUTES.map(r => ({
        kind: 'page' as const,
        label: r.name,
        path: r.path,
        icon: r.icon,
      }));
    }

    const out: SearchResult[] = [];

    // Pages
    for (const r of ROUTES) {
      if (r.name.toLowerCase().includes(q) || r.keywords.includes(q)) {
        out.push({ kind: 'page', label: r.name, path: r.path, icon: r.icon });
      }
    }

    // Tenants: search by name, email, or phone.
    for (const t of tenants) {
      const fullName = `${t.firstName} ${t.lastName}`.toLowerCase();
      const email = (t.email || '').toLowerCase();
      const phone = (t.phone || '').replace(/\D/g, '');
      const qDigits = q.replace(/\D/g, '');

      if (
        fullName.includes(q) ||
        email.includes(q) ||
        (qDigits.length >= 3 && phone.includes(qDigits))
      ) {
        // Build sublabel: unit + property.
        const lease = leases.find(
          l => l.status !== 'ended' && l.tenantIds?.includes(t.id)
        );
        let sublabel = t.email || '';
        if (lease) {
          const unit = lease.unitId ? units.find(u => u.id === lease.unitId) : null;
          const prop = lease.propertyId ? properties.find(p => p.id === lease.propertyId) : null;
          const parts: string[] = [];
          if (prop) parts.push(prop.name);
          if (unit) parts.push(`Unit ${unit.unitNumber}`);
          if (parts.length) sublabel = parts.join(', ');
        }

        out.push({
          kind: 'tenant',
          label: `${t.firstName} ${t.lastName}`,
          sublabel,
          path: `/tenants/${t.id}`,
          icon: User,
        });
      }
    }

    // Properties: search by name or address.
    for (const p of properties) {
      const name = p.name.toLowerCase();
      const addr = p.address.toLowerCase();
      if (name.includes(q) || addr.includes(q)) {
        out.push({
          kind: 'property',
          label: p.name,
          sublabel: p.address,
          path: `/properties/${p.id}`,
          icon: Home,
        });
      }
    }

    return out;
  }, [query, tenants, properties, units, leases]);

  // Keep the selected item scrolled into view.
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.children[selected] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

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

  if (!mounted) return null;

  // Group results by kind for section headers.
  const pages = results.filter(r => r.kind === 'page');
  const tenantResults = results.filter(r => r.kind === 'tenant');
  const propertyResults = results.filter(r => r.kind === 'property');
  const hasQuery = query.trim().length > 0;

  // Flat ordered list for keyboard index tracking.
  const ordered = [...pages, ...tenantResults, ...propertyResults];

  return (
    <>
      {/* Overlay */}
      <div
        className={`fixed inset-0 bg-ink/30 backdrop-blur-[2px] z-[60] ${phase === 'entering' ? 'backdrop-enter' : 'backdrop-exit'}`}
        onClick={() => setOpen(false)}
      />

      {/* Palette */}
      <div className="fixed top-[15%] left-1/2 -translate-x-1/2 z-[61] w-full max-w-lg mx-auto px-4">
        <div className={`bg-surface rounded-xl shadow-2xl border border-line overflow-hidden ${phase === 'entering' ? 'modal-enter' : 'modal-exit'}`}>
          {/* Search input */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-line">
            <Search className="h-4 w-4 text-muted flex-shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => { setQuery(e.target.value); setSelected(0); }}
              onKeyDown={handleKeyDown}
              placeholder="Search pages, tenants, properties..."
              className="flex-1 bg-transparent text-sm text-ink placeholder:text-faint outline-none"
            />
            <kbd className="hidden sm:inline-flex px-1.5 py-0.5 rounded border border-line bg-canvas text-[10px] text-muted font-mono">
              ESC
            </kbd>
          </div>

          {/* Results */}
          <div ref={listRef} className="max-h-80 overflow-y-auto py-1">
            {ordered.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-muted">No results found.</div>
            ) : (
              <>
                {/* Pages section */}
                {pages.length > 0 && (
                  <>
                    {hasQuery && (
                      <p className="px-4 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-faint">Pages</p>
                    )}
                    {pages.map(r => {
                      const idx = ordered.indexOf(r);
                      return <ResultRow key={r.path} result={r} isSelected={idx === selected} onSelect={() => { navigate(r.path); setOpen(false); }} onHover={() => setSelected(idx)} />;
                    })}
                  </>
                )}

                {/* Tenants section */}
                {tenantResults.length > 0 && (
                  <>
                    <p className="px-4 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-faint">Tenants</p>
                    {tenantResults.map(r => {
                      const idx = ordered.indexOf(r);
                      return <ResultRow key={r.path} result={r} isSelected={idx === selected} onSelect={() => { navigate(r.path); setOpen(false); }} onHover={() => setSelected(idx)} />;
                    })}
                  </>
                )}

                {/* Properties section */}
                {propertyResults.length > 0 && (
                  <>
                    <p className="px-4 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-faint">Properties</p>
                    {propertyResults.map(r => {
                      const idx = ordered.indexOf(r);
                      return <ResultRow key={r.path} result={r} isSelected={idx === selected} onSelect={() => { navigate(r.path); setOpen(false); }} onHover={() => setSelected(idx)} />;
                    })}
                  </>
                )}
              </>
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

function ResultRow({ result, isSelected, onSelect, onHover }: {
  result: SearchResult;
  isSelected: boolean;
  onSelect: () => void;
  onHover: () => void;
}) {
  const Icon = result.icon;
  return (
    <button
      onClick={onSelect}
      onMouseEnter={onHover}
      className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
        isSelected ? 'bg-primary-soft text-primary' : 'text-ink hover:bg-canvas'
      }`}
    >
      <Icon className="h-4 w-4 flex-shrink-0" />
      <span className="flex-1 text-left min-w-0">
        <span className="block truncate">{result.label}</span>
        {result.sublabel && (
          <span className={`block text-xs truncate ${isSelected ? 'text-primary/60' : 'text-muted'}`}>
            {result.sublabel}
          </span>
        )}
      </span>
      {isSelected && (
        <span className="text-xs text-muted flex-shrink-0">↵ Enter</span>
      )}
    </button>
  );
}
