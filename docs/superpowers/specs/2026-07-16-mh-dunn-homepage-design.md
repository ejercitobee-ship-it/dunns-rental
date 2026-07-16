# MH Dunn Property public homepage

Date: 2026-07-16
Status: approved design, ready for implementation plan
Project: a public front door for the existing MH Dunn management app

## Why

Today every visitor to the site lands on a login wall. There is nothing for a
prospective tenant, a neighbor, or anyone handed a business card. A simple
public homepage gives the business a real front door: it builds trust, it gives
people a way to find MH Dunn and reach out, and it gives the login screen a
place to live behind. It also sets up the future tenant portal, since the public
site is the natural shell for a tenant login.

## Decisions

Taken from the brainstorming conversation with Belle:

1. Audience: both renters and owners, renters first. The page speaks mainly to
   people looking for a home, with one smaller section inviting property owners
   to reach out about management.
2. No listings in v1. The page describes the kind of homes MH Dunn offers and
   invites people to contact for current availability. Live listings are a later
   project (they tie into the tenant portal), not part of this one.
3. Contact is email and phone shown on the page. No inquiry form and no backend,
   so the whole homepage is static frontend.
4. A Tenant Login button is clearly visible in the top-right corner.
5. Architecture: the homepage is a public page inside the existing React app,
   not a separate site. It reuses the logo, the family photo, and the existing
   evergreen and gold styling. Rejected: a separate marketing site (two
   codebases, trickier domain setup) and a hand-coded HTML file (cannot reuse
   the app's look and feel).

## Content inputs still needed

These are content, not design questions. They are provided before or during the
build:

- **Phone number** for the contact section. If it is not supplied by build time,
  the contact section shows email only and omits the phone line.
- **Service area** (a city or region), optional. If supplied, it appears in the
  hero or contact section and in the page's meta description, which helps with
  trust and local search. If not supplied, it is simply left out.

Email is known: info@mhdunnproperty.net.

## Architecture

The homepage is a public route in the existing Cloudflare Pages React app
(`~/dunns-rental`). It reuses the design tokens in `src/index.css` (the "Estate"
palette: canvas `#f6f5f1`, evergreen primary `#24503f`, gold accents, Fraunces
display font, Hanken Grotesk body), the logo at `src/assets/mh-dunn-logo.png`,
and the photo at `src/assets/login-family.jpg`.

### Routing (deliberately minimal)

The dashboard currently lives at `/` behind `ProtectedRoute`. Rather than move
it (which would touch every internal link), the `/` route becomes conditional on
auth state:

- Logged out: `/` renders the new public `Home` page.
- Logged in: `/` renders the dashboard exactly as it does today.

This means **no existing navigation, link, or redirect changes**. A logged-in
user's logo link, the Dashboard nav item, the login-success redirect, and the
`PublicRoute` and catch-all redirects all still resolve to `/` and still land on
the dashboard, because the viewer is authenticated. A logged-out visitor at any
unknown URL falls through the catch-all to `/` and sees the homepage.

Consequence, accepted for v1: a logged-in user cannot view the marketing page at
`/` without logging out. That is fine, the marketing page is for logged-out
visitors, and the tenant login on it always reads "Tenant Login" as a result.

The single code change in `src/App.tsx` is to replace the `/` route element with
a small component that returns `<Home />` when `!isAuthenticated` and the
existing `<Layout><Dashboard /></Layout>` when authenticated. `Home` is not
wrapped in `ProtectedRoute` or `PublicRoute`.

### Components

- `src/pages/Home.tsx` composes the page from section pieces and owns the
  smooth-scroll anchor behavior for the nav links.
- `src/components/marketing/PublicHeader.tsx`: sticky top bar, logo left, anchor
  links (Homes, About, Contact) center, a green Tenant Login button
  (`Link to="/login"`) top-right. Collapses to logo + Login on narrow screens.
- `src/components/marketing/PublicFooter.tsx`: logo, tagline, copyright, and a
  quiet second login link.
- The section blocks (Hero, About, Features, Owners, Contact) live inside
  `Home.tsx` as local section components, since none is reused elsewhere. If any
  grows large it is extracted to `src/components/marketing/`.

No new dependencies. Icons come from the `lucide-react` package already in use;
the Button comes from `src/components/ui/Button`.

## The page, top to bottom

A single scrolling page. The header nav links jump to anchored sections.

1. **Header** (`PublicHeader`): logo left; anchor links Homes, About, Contact;
   evergreen Tenant Login button top-right. Sticky, on a `surface`/white bar with
   a hairline bottom border. On mobile the center links collapse and only the
   logo and the Login button remain.
2. **Hero:** the family and home photo as the background with the same dark
   evergreen gradient used on the login page, a Fraunces headline ("Quality
   multi family homes for rent"), a warm sentence beneath, and an evergreen
   button that smooth-scrolls to Contact. Full width, tall but not full screen.
3. **About MH Dunn:** a short, trust-building paragraph on who MH Dunn is and how
   it cares for its homes and tenants. Plain, centered, on the canvas background.
4. **Why rent with us:** three or four cards, each a lucide icon in an
   evergreen-soft circle, a short heading, and a line of text. Content:
   well-maintained homes, responsive management, easy online rent and documents,
   family-friendly. Responsive grid, one column on mobile.
5. **Own a property?:** a smaller full-width band in evergreen (or evergreen-soft)
   inviting owners to reach out about management, with the contact email as the
   call to action. This is the "renters first, owners too" piece.
6. **Contact:** email (info@mhdunnproperty.net) and phone shown clearly as
   tappable `mailto:` and `tel:` links, with a line inviting people to ask about
   current availability. Service area shown here if supplied.
7. **Footer** (`PublicFooter`): logo, the tagline, a copyright line, and a quiet
   text login link.

## Copy and brand rules

- All visible copy avoids dashes as punctuation (em, en, or hyphen-as-a-break),
  per Belle's standing preference. Use commas, periods, or colons.
- Voice is warm, plain, and concrete. No stock filler.
- Reuse the existing palette and fonts only. No new colors or fonts.

## SEO basics (no SSR)

The app is a client-rendered SPA and stays that way; server rendering is out of
scope. Within that, the basics: a descriptive `<meta name="description">` in
`index.html` (the title is already "MH Dunn Property"), semantic landmark
elements (`header`, `main`, `section`, `footer`) with real headings, descriptive
`alt` text on the logo and photo, and the service area in the copy when supplied.

## Testing and verification

The page is static and visual, so verification is by eye against the real build:

1. `npm run build` stays green and `npm test` (the existing rent math suite) is
   untouched and still passes.
2. Logged out, `/` shows the homepage; the Tenant Login button and the footer
   link both reach `/login`.
3. Logged in, `/` still shows the dashboard, and every existing internal link
   still works (the routing change is conditional-only).
4. The nav anchor links scroll to their sections.
5. The page holds up at a phone width (roughly 390px) and a desktop width: no
   horizontal scroll, the header collapses gracefully, the hero text stays
   readable over the photo.
6. Email and phone links open a mail client and a dialer.

## Out of scope

- Live or featured listings of available homes (later project, tied to the
  tenant portal).
- Any inquiry form or lead capture, and any backend or email sending for the
  homepage.
- Server-side rendering or a static prerender step.
- A tenant-facing portal or any authenticated tenant view.
- Pointing the `mhdunnproperty.net` domain at the app, which is a DNS task Belle
  can do separately whenever she wants.
