import { Link } from 'react-router-dom';
import { Wrench, Mail, ArrowRight, KeyRound, Building2, FileText } from 'lucide-react';
import logo from '../assets/mh-dunn-logo.png';

const EMAIL = 'info@mhdunnproperty.net';

const PORTALS = [
  {
    icon: KeyRound,
    title: 'Tenants',
    description: 'Pay rent, request repairs, view your lease and receipts.',
    cta: 'Resident login',
    href: '/login',
    highlight: true,
  },
  {
    icon: Building2,
    title: 'Team',
    description: 'Property management, financials, and operations.',
    cta: 'Team login',
    href: '/login',
    highlight: false,
  },
  {
    icon: Wrench,
    title: 'Vendors',
    description: 'Submit invoices and coordinate maintenance work.',
    cta: 'Vendor login',
    href: '/login',
    highlight: false,
  },
];

export function Home() {
  return (
    <div className="min-h-screen bg-canvas flex flex-col">
      {/* Page */}
      <main className="flex-1 flex items-center justify-center px-4 sm:px-6 py-12 sm:py-20">
        <div className="w-full max-w-lg text-center">
          {/* Logo */}
          <img src={logo} alt="MH Dunn Property" className="mx-auto w-56 sm:w-64 h-auto" />

          <p className="mt-4 text-muted text-sm sm:text-base leading-relaxed max-w-sm mx-auto">
            Family owned quality multi family homes in Chicago, managed with care for over 20 years.
          </p>

          {/* Portal cards */}
          <div className="mt-10 space-y-3">
            {PORTALS.map(({ icon: Icon, title, description, href, highlight }) => (
              <Link
                key={title}
                to={href}
                className={`group flex items-center gap-4 rounded-2xl border p-4 sm:p-5 text-left transition-all ${
                  highlight
                    ? 'bg-primary border-primary text-white hover:bg-primary-hover'
                    : 'bg-surface border-line hover:border-line-strong hover:shadow-[0_2px_12px_rgba(27,26,23,0.06)]'
                }`}
              >
                <div className={`flex h-11 w-11 items-center justify-center rounded-xl flex-shrink-0 ${
                  highlight ? 'bg-white/15' : 'bg-primary-soft'
                }`}>
                  <Icon className={`h-5 w-5 ${highlight ? 'text-white' : 'text-primary'}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`font-medium ${highlight ? 'text-white' : 'text-ink'}`}>{title}</p>
                  <p className={`text-sm mt-0.5 ${highlight ? 'text-white/75' : 'text-muted'}`}>{description}</p>
                </div>
                <ArrowRight className={`h-4 w-4 flex-shrink-0 transition-transform group-hover:translate-x-0.5 ${
                  highlight ? 'text-white/60' : 'text-faint'
                }`} />
              </Link>
            ))}
          </div>

          {/* Quick links */}
          <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm">
            <a
              href="https://docs.google.com/forms/d/e/1FAIpQLScmhjlJoOsNg3u4gmECajZJy8MXPXcGNm0osf3_QxmOmAf2xw/viewform?usp=header"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-primary hover:text-primary-hover font-medium"
            >
              <FileText className="h-3.5 w-3.5" />
              Request tenant access
            </a>
            <a
              href={`mailto:${EMAIL}`}
              className="inline-flex items-center gap-1.5 text-muted hover:text-ink"
            >
              <Mail className="h-3.5 w-3.5" />
              {EMAIL}
            </a>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="py-6 text-center">
        <p className="text-xs text-faint">© 2026 MH Dunn Property. All rights reserved.</p>
      </footer>
    </div>
  );
}
