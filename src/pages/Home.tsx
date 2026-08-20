import { Link } from 'react-router-dom';
import { Mail, ArrowRight } from 'lucide-react';
import logo from '../assets/mh-dunn-logo.png';
import heroPhoto from '../assets/login-family.jpg';
import dunnFamily from '../assets/dunn-family.jpg';

const EMAIL = 'info@mhdunnproperty.net';

export function Home() {
  return (
    <div className="min-h-screen bg-canvas flex flex-col">
      {/* Hero */}
      <section className="relative overflow-hidden">
        <img src={heroPhoto} alt="A family relaxing with their dog in the yard of a home" className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-tr from-[#14231c]/85 via-[#14231c]/55 to-[#14231c]/25" />

        {/* Header bar */}
        <div className="relative mx-auto max-w-6xl px-4 sm:px-6 pt-6 flex items-center justify-between">
          <img src={logo} alt="MH Dunn Property" className="h-9 w-auto brightness-0 invert" />
          <Link
            to="/login"
            className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-medium text-primary hover:bg-white/90 transition-colors"
          >
            Login
          </Link>
        </div>

        {/* Hero content */}
        <div className="relative mx-auto max-w-6xl px-4 sm:px-6 py-20 sm:py-28">
          <div className="max-w-xl">
            <p className="text-sm font-medium tracking-wide uppercase text-white/60">MH Dunn Property</p>
            <h1 className="font-display text-4xl sm:text-5xl font-medium text-white leading-tight mt-3">
              A place you'll be glad to call home
            </h1>
            <p className="mt-5 text-lg text-white/85 leading-relaxed">
              We are a family that owns and cares for the homes we rent. Living here is meant to feel easy. Pay your rent online, ask for a repair, and find your lease and receipts in one place, whenever it suits you.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                to="/login"
                className="inline-flex items-center gap-2 rounded-lg bg-white px-5 py-3 text-sm font-semibold text-primary hover:bg-white/90 transition-colors"
              >
                Sign in <ArrowRight className="h-4 w-4" />
              </Link>
              <a
                href={`mailto:${EMAIL}`}
                className="inline-flex items-center gap-2 rounded-lg border border-white/40 px-5 py-3 text-sm font-medium text-white hover:bg-white/10 transition-colors"
              >
                Contact us
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* About */}
      <section className="flex-1 bg-canvas">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 py-16 sm:py-20">
          <p className="text-sm font-medium tracking-wide uppercase text-primary">About MH Dunn</p>
          <h2 className="font-display text-3xl font-medium text-ink mt-3">Meet Marlene and Terry</h2>

          <div className="mt-6 text-lg text-muted leading-relaxed [&>p]:mb-4 [&>p:last-child]:mb-0">
            <figure className="mb-5 sm:float-left sm:mr-7 sm:mb-3 sm:w-[44%] sm:max-w-xs">
              <img
                src={dunnFamily}
                alt="Marlene and Terry Dunn"
                className="w-full rounded-2xl border border-line object-cover shadow-[0_2px_16px_rgba(27,26,23,0.08)]"
              />
              <figcaption className="mt-3 text-center text-sm text-faint">Marlene and Terry Dunn</figcaption>
            </figure>
            <p>
              MH Dunn Property is a family-owned business built by Marlene and Terry Dunn. The name comes from Marlene's first and middle initials, combined with the Dunn family name.
            </p>
            <p>
              For more than 20 years, they've owned and cared for these homes together. They believe that being a landlord is about more than maintaining properties. It's about creating places where people feel comfortable calling home.
            </p>
            <p>
              Before dedicating his time to the business, Terry served with the Chicago Police Department for many years. He brings that same dependable, hands-on approach to every property. When something needs to be fixed or taken care of, he's often the one who shows up.
            </p>
            <p>
              Marlene focuses on building relationships with tenants. She knows the properties, the people who live in them, and believes everyone deserves to be treated with respect and care, not as just another name on a lease.
            </p>
            <p>
              When you rent from MH Dunn Property, you're working directly with the people who own and care for your home.
            </p>
            <div className="clear-both" />
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-sidebar text-white/70">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="bg-white rounded-lg px-3 py-2">
              <img src={logo} alt="MH Dunn Property" className="h-7 w-auto" />
            </div>
            <p className="text-sm text-white/50">Quality multi family homes for rent</p>
          </div>
          <div className="flex items-center gap-6 text-sm">
            <a href={`mailto:${EMAIL}`} className="inline-flex items-center gap-1.5 hover:text-white transition-colors">
              <Mail className="h-3.5 w-3.5" /> {EMAIL}
            </a>
            <Link to="/login" className="hover:text-white transition-colors">Login</Link>
          </div>
        </div>
        <div className="border-t border-sidebar-line">
          <p className="mx-auto max-w-6xl px-4 sm:px-6 py-4 text-xs text-white/40">
            © 2026 MH Dunn Property. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
