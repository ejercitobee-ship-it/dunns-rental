import { Link } from 'react-router-dom';
import { Home as HomeIcon, PhoneCall, Wallet, Users, Mail, ArrowRight, MapPin } from 'lucide-react';
import logo from '../assets/mh-dunn-logo.png';
import heroPhoto from '../assets/login-family.jpg';
import dunnFamily from '../assets/dunn-family.jpg';

// Business contact details. Phone and service area are placeholders until Belle
// supplies the real values; swap them here.
const EMAIL = 'info@mhdunnproperty.net';
const PHONE_DISPLAY = '(555) 123-4567';
const PHONE_HREF = 'tel:+15551234567';
const SERVICE_AREA = 'your local area';

function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
}

function PublicHeader() {
  return (
    <header className="sticky top-0 z-40 bg-surface/95 backdrop-blur border-b border-line">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 h-16 flex items-center justify-between">
        <button onClick={() => scrollToId('top')} className="flex items-center" aria-label="MH Dunn Property, back to top">
          <img src={logo} alt="MH Dunn Property" className="h-9 w-auto" />
        </button>

        <nav className="hidden md:flex items-center gap-8 text-sm text-muted">
          <button onClick={() => scrollToId('top')} className="hover:text-ink transition-colors">Homes</button>
          <button onClick={() => scrollToId('about')} className="hover:text-ink transition-colors">About</button>
          <button onClick={() => scrollToId('contact')} className="hover:text-ink transition-colors">Contact</button>
        </nav>

        <Link
          to="/login"
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover transition-colors"
        >
          Login
        </Link>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section id="top" className="relative overflow-hidden">
      <img src={heroPhoto} alt="A family relaxing with their dog in the yard of a home" className="absolute inset-0 h-full w-full object-cover" />
      <div className="absolute inset-0 bg-gradient-to-tr from-[#14231c]/85 via-[#14231c]/55 to-[#14231c]/25" />
      <div className="relative mx-auto max-w-6xl px-4 sm:px-6 py-24 sm:py-32">
        <div className="max-w-xl">
          <p className="eyebrow text-white/70">MH Dunn Property</p>
          <h1 className="font-display text-4xl sm:text-5xl font-medium text-white leading-tight mt-3">
            Quality multi family homes for rent
          </h1>
          <p className="mt-5 text-lg text-white/85 leading-relaxed">
            Family run, well cared for homes where people are glad to live. If you are looking for a place to call home, we would love to hear from you.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <button
              onClick={() => scrollToId('contact')}
              className="inline-flex items-center gap-2 rounded-lg bg-white px-5 py-3 text-sm font-semibold text-primary hover:bg-white/90 transition-colors"
            >
              Get in touch <ArrowRight className="h-4 w-4" />
            </button>
            <button
              onClick={() => scrollToId('about')}
              className="inline-flex items-center gap-2 rounded-lg border border-white/40 px-5 py-3 text-sm font-medium text-white hover:bg-white/10 transition-colors"
            >
              Learn more
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function About() {
  return (
    <section id="about" className="bg-canvas">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-20">
        <p className="eyebrow text-primary">About MH Dunn</p>
        <h2 className="font-display text-3xl font-medium text-ink mt-3">Meet Marlene and Terry</h2>
        <figure className="mt-8">
          <img
            src={dunnFamily}
            alt="Marlene and Terry Dunn"
            className="w-full rounded-2xl border border-line object-cover shadow-[0_2px_16px_rgba(27,26,23,0.08)]"
          />
          <figcaption className="mt-3 text-center text-sm text-faint">Marlene and Terry Dunn</figcaption>
        </figure>
        <div className="mt-8 space-y-4 text-lg text-muted leading-relaxed">
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
            At the end of the day, MH Dunn Property is simply a small family business that takes pride in providing well-maintained homes and being there when tenants need them. When you rent from MH Dunn Property, you're working directly with the people who own and care for your home.
          </p>
        </div>
      </div>
    </section>
  );
}

const FEATURES = [
  { icon: HomeIcon, title: 'Well maintained homes', body: 'Clean, safe, and cared for. We fix things properly and keep our homes in the condition we would want for our own family.' },
  { icon: PhoneCall, title: 'Responsive management', body: 'A real person answers. When something needs attention, you are not left waiting or wondering.' },
  { icon: Wallet, title: 'Easy online rent', body: 'Pay rent and keep your documents in one simple place, from any device, whenever it suits you.' },
  { icon: Users, title: 'Family friendly', body: 'Comfortable homes with room to live, in neighborhoods that families are happy to settle into.' },
];

function Features() {
  return (
    <section className="bg-surface border-y border-line">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-20">
        <div className="text-center max-w-2xl mx-auto">
          <p className="eyebrow text-primary">Why rent with us</p>
          <h2 className="font-display text-3xl font-medium text-ink mt-3">Renting, made to feel like home</h2>
        </div>
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-2xl border border-line bg-canvas p-6">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary-soft">
                <Icon className="h-5 w-5 text-primary" />
              </div>
              <h3 className="mt-4 font-medium text-ink">{title}</h3>
              <p className="mt-2 text-sm text-muted leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Owners() {
  return (
    <section className="bg-primary">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 py-16 text-center">
        <h2 className="font-display text-3xl font-medium text-white">Own a property? Let us manage it.</h2>
        <p className="mt-4 text-lg text-white/80 leading-relaxed max-w-2xl mx-auto">
          We also manage homes for other owners with the same care we give our own. If you would like a dependable team looking after your property and your tenants, reach out and let us talk.
        </p>
        <a
          href={`mailto:${EMAIL}?subject=Property%20management%20enquiry`}
          className="mt-8 inline-flex items-center gap-2 rounded-lg bg-white px-5 py-3 text-sm font-semibold text-primary hover:bg-white/90 transition-colors"
        >
          Email us about management <ArrowRight className="h-4 w-4" />
        </a>
      </div>
    </section>
  );
}

function Contact() {
  return (
    <section id="contact" className="bg-canvas">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-20 text-center">
        <p className="eyebrow text-primary">Contact</p>
        <h2 className="font-display text-3xl font-medium text-ink mt-3">Get in touch</h2>
        <p className="mt-4 text-lg text-muted leading-relaxed">
          Ask us about current availability or anything else. We are happy to help.
        </p>

        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          <a href={`mailto:${EMAIL}`} className="flex items-center gap-4 rounded-2xl border border-line bg-surface p-5 text-left hover:border-line-strong transition-colors">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary-soft">
              <Mail className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="eyebrow text-faint">Email</p>
              <p className="text-ink font-medium">{EMAIL}</p>
            </div>
          </a>

          <a href={PHONE_HREF} className="flex items-center gap-4 rounded-2xl border border-line bg-surface p-5 text-left hover:border-line-strong transition-colors">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary-soft">
              <PhoneCall className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="eyebrow text-faint">Phone</p>
              <p className="text-ink font-medium">{PHONE_DISPLAY}</p>
            </div>
          </a>
        </div>

        <p className="mt-8 inline-flex items-center gap-2 text-sm text-muted">
          <MapPin className="h-4 w-4 text-faint" /> Serving {SERVICE_AREA}
        </p>
      </div>
    </section>
  );
}

function PublicFooter() {
  return (
    <footer className="bg-sidebar text-white/70">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-10 flex flex-col sm:flex-row items-center justify-between gap-6">
        <div className="flex items-center gap-3">
          <div className="bg-white rounded-lg px-3 py-2">
            <img src={logo} alt="MH Dunn Property" className="h-8 w-auto" />
          </div>
          <p className="text-sm text-white/60">Quality multi family homes for rent</p>
        </div>
        <div className="flex items-center gap-6 text-sm">
          <a href={`mailto:${EMAIL}`} className="hover:text-white transition-colors">{EMAIL}</a>
          <Link to="/login" className="hover:text-white transition-colors">Login</Link>
        </div>
      </div>
      <div className="border-t border-sidebar-line">
        <p className="mx-auto max-w-6xl px-4 sm:px-6 py-4 text-xs text-white/40">
          © 2026 MH Dunn Property. All rights reserved.
        </p>
      </div>
    </footer>
  );
}

export function Home() {
  return (
    <div className="min-h-screen bg-canvas">
      <PublicHeader />
      <main>
        <Hero />
        <About />
        <Features />
        <Owners />
        <Contact />
      </main>
      <PublicFooter />
    </div>
  );
}
