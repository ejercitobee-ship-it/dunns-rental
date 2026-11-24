// Knowledge base for the AI Assistant's "how do I use the app" / training mode.
//
// This is NOT live data — it is static how-to and feature guidance about the MH
// Dunn Property app itself, so the assistant can onboard and train internal
// staff. The `getAppHelp` tool (functions/lib/ai-tools.ts) looks articles up
// from here. To add or correct guidance, edit the HELP_ARTICLES array; keep each
// body concise and written as plain steps the office team can follow.

export interface HelpArticle {
  id: string;
  title: string;
  keywords: string[];
  body: string;
}

export const HELP_ARTICLES: HelpArticle[] = [
  {
    id: 'getting-started',
    title: 'Getting started & navigating the app',
    keywords: ['start', 'navigation', 'sidebar', 'menu', 'overview', 'login', 'home', 'sections', 'where'],
    body: 'The left sidebar groups everything by workflow: Workspace (Dashboard, AI Assistant), Property Management (Properties, Tenants, Maintenance, Tasks, Calendar), Financial Management (Rent Management, Finances, Payment Plans), Communication (Messages, Announcements, Email), and Administration (Settings, Users, Data Migration, Activity Logs). Click a section header to collapse or expand it. The Dashboard is the home base: this-month KPIs (collected, expenses, net cash flow, collection rate) and a "Needs Attention" panel with tabs for Past due, Overdue, Deposits, Contracts (fixed-term leases by soonest expiry), and Vacant. The notification bell is top-right on every page.',
  },
  {
    id: 'add-property-unit',
    title: 'Adding a property and its units',
    keywords: ['property', 'properties', 'unit', 'units', 'building', 'add property', 'occupancy'],
    body: 'Go to Properties to add a building and its units. Open a property to see its profile: units, occupancy, utilities, and activity. Occupancy and vacancy are calculated from active leases, so a unit shows vacant when no lease covers the current month. Units you are holding or that are under maintenance are handled separately from ordinary vacancy.',
  },
  {
    id: 'add-tenant',
    title: 'Adding a tenant and prospective applicants',
    keywords: ['tenant', 'tenants', 'add tenant', 'applicant', 'prospective', 'convert', 'onboard', 'new tenant'],
    body: 'The Tenants page has two tabs: Active and Prospective. Add an applicant under Prospective to collect their info and documents before they move in, then use Convert to turn them into an active tenant with a lease. Each tenant has a profile page with their lease, payment history, messages, documents, deposits, inspections, and notices. Tenants are invited to the tenant portal with a set-password email.',
  },
  {
    id: 'leases',
    title: 'Creating and managing leases',
    keywords: ['lease', 'leases', 'fixed', 'month to month', 'contract', 'renewal', 'renew', 'end lease', 'terminate', 'due day', 'expire', 'expiring'],
    body: 'A lease ties a tenant (or several) to a unit with a monthly rent. Lease type is Fixed-term (has an end date and shows expiration warnings) or Month-to-month (no end date). Rent is due on a day you set globally in Settings, or per-lease when a lease needs its own due day. Renewals must be approved to bill rent (pending/draft/rejected renewals do not). End a lease from the Tenant Profile tenancy actions, which captures the end date and reason. The Dashboard "Contracts" tab lists fixed-term leases by soonest expiry so you can plan renewals.',
  },
  {
    id: 'record-rent-payment',
    title: 'Recording a rent payment',
    keywords: ['rent', 'payment', 'record payment', 'pay rent', 'collected', 'paid', 'rent management', 'allocation'],
    body: 'Open Rent Management to see each tenant and what they owe this month (owe-first, overdue flagged). Record a payment against a tenant/lease and it settles that month; if the payment is larger than one month, it allocates across months, and any excess carries forward to reduce the next month. A manually recorded paid payment also generates a PDF receipt to the tenant. Rent tracking in this app starts January 2026 — nothing is owed for months before that.',
  },
  {
    id: 'credits-carryforward',
    title: 'Credits, carry-forward, and balances',
    keywords: ['credit', 'credits', 'carry forward', 'overpayment', 'balance', 'owe', 'refund', 'proration'],
    body: 'A credit (proration, maintenance concession, etc.) reduces what a tenant owes but is NOT counted as income. Overpayments carry forward automatically to reduce later months. A single month\'s balance may not reflect carry-forward from prior months — the tenant profile shows the true current balance. Leases starting mid-month (from July 2026 on) are prorated.',
  },
  {
    id: 'late-fees',
    title: 'Late fees',
    keywords: ['late fee', 'late fees', 'penalty', 'overdue', 'grace period', 'jurisdiction'],
    body: 'Late-fee rules are configured in Settings (amount, grace period, and a per-jurisdiction cap). A tenant is overdue when the monthly due day has passed and rent is still owed. Late fees are applied per your policy; the Dashboard "Overdue" tab surfaces tenants who are past due.',
  },
  {
    id: 'payment-plans',
    title: 'Payment plans',
    keywords: ['payment plan', 'plans', 'installment', 'arrears', 'catch up', 'schedule payments'],
    body: 'Payment Plans let a tenant who is behind pay off a balance in scheduled installments. Create a plan for a tenant/lease with the installment amounts and dates; the tenant can see it in their portal, and installment reminders are emailed. This is for structured catch-up on arrears, separate from ordinary monthly rent.',
  },
  {
    id: 'maintenance-flow',
    title: 'Maintenance requests end to end',
    keywords: ['maintenance', 'repair', 'request', 'handyman', 'assign', 'schedule', 'complete', 'work order', 'fix'],
    body: 'Tenants report issues from their portal (with availability and a photo); the office and matching handymen are notified. On the Maintenance page you assign a handyman (or release the job for handymen to claim), they schedule and do the work, then mark it complete. The assigned handyman sees the tenant\'s name and phone; the tenant sees the assigned vendor\'s company, name, and phone in their portal. After completion you approve the work, which records an expense, and the handyman can submit an invoice for approval and payment.',
  },
  {
    id: 'vendor-invoice',
    title: 'Vendor invoice form (no-login link)',
    keywords: ['vendor', 'invoice', 'contractor', 'vendor form', 'token link', 'bill'],
    body: 'For an outside vendor, you can email a secure no-login link where they fill in their company, contact, the work description, and the amount. Their submission comes back to the Maintenance page for you to approve, reject, or pay. This is for billing an external vendor and is separate from the in-portal handyman roster.',
  },
  {
    id: 'finances',
    title: 'Finances: expenses, income, reports',
    keywords: ['finances', 'expense', 'expenses', 'income', 'reports', 'tax', 'capital', 'import', 'profit', 'accounting'],
    body: 'Finances holds Expenses & Income (record and categorize transactions), Capital Projects (larger improvements tracked separately), Reports (collection, income/expense, operating performance), Tax Report (operating vs capital split, depreciation, mortgage interest/principal, deposits-not-income), and Expense Imports (bulk-import a spreadsheet of expenses). Rent collected flows into income automatically, so the Finances and Dashboard figures agree.',
  },
  {
    id: 'calendar-tasks',
    title: 'Calendar and Tasks',
    keywords: ['calendar', 'task', 'tasks', 'event', 'reminder', 'schedule', 'to do'],
    body: 'The Calendar tracks dated events (lease dates, scheduled work, reminders) and Tasks is an Asana-style board for office to-dos. Both help the team stay on top of what is due.',
  },
  {
    id: 'messaging',
    title: 'Messaging tenants, vendors, and realtors',
    keywords: ['message', 'messages', 'chat', 'contact tenant', 'communication', 'reply'],
    body: 'Messages is two-way chat between the office and each tenant, handyman, or realtor, with unread badges and email + push both ways. Use it for one-to-one conversations. For one-to-many, use Announcements (a notice to tenants) or Email Campaigns.',
  },
  {
    id: 'email-campaigns',
    title: 'Email campaigns and templates',
    keywords: ['email', 'campaign', 'campaigns', 'template', 'templates', 'blast', 'newsletter', 'send email', 'segment', 'reminder'],
    body: 'Under Email, Campaigns is the full tool to email tenants: build a message (use a saved Template and the {{variable}} picker), choose recipients by segment (all active, by property, lease expiring/month-to-month, or by balance/overdue/open-maintenance), preview the audience, send yourself a test, then Send now. Each send is tracked per recipient (sent/failed). Email Templates is the reusable library. (The old standalone Reminders page was removed — use Campaigns for building-wide messages.)',
  },
  {
    id: 'announcements',
    title: 'Announcements',
    keywords: ['announcement', 'announcements', 'notice', 'broadcast', 'all tenants'],
    body: 'Announcements posts a notice that tenants see in their portal. Use it for building-wide information. For a formatted email to tenants, use an Email Campaign instead.',
  },
  {
    id: 'notifications',
    title: 'Notifications',
    keywords: ['notification', 'notifications', 'bell', 'alerts', 'unread'],
    body: 'The bell at the top-right shows unread notifications (maintenance, approvals, payments, messages, and more) with a dropdown of recent items and a link to the full Notifications page. Click an item to jump to the related record.',
  },
  {
    id: 'users-permissions',
    title: 'Users, roles, and permissions',
    keywords: ['user', 'users', 'role', 'roles', 'permission', 'permissions', 'access', 'staff', 'invite', 'team'],
    body: 'Users manages your team. Each user has a role, and permissions are granular (52 permissions across modules) with per-user overrides, so you can give someone access to exactly what they need. Adding a team member emails them a set-password invite. Portal roles (tenant, realtor, handyman) have no management permissions — they only see their own portal.',
  },
  {
    id: 'settings',
    title: 'Settings',
    keywords: ['settings', 'company', 'configuration', 'rent due day', 'utility', 'templates', 'identity', 'preferences'],
    body: 'Settings holds your company identity (name, address — used on receipts and emails), the global rent due day, late-fee rules, utility accounts you pay per property, and a Templates tab (lease/application/rules documents you can send to prospective tenants). Change these in one place and they apply across the app.',
  },
  {
    id: 'portals',
    title: 'The tenant, handyman, and realtor portals',
    keywords: ['portal', 'tenant portal', 'handyman portal', 'realtor', 'app', 'what tenants see', 'mobile'],
    body: 'Invited tenants get a mobile-style portal to see their rent and pay, report and track maintenance (with the assigned vendor\'s contact), message the office, and view documents. Handymen get a jobs portal to claim, schedule, complete, and invoice work. Realtors get a limited window to available units and their referred tenants. Everyone uses the same login door; their role decides what they see.',
  },
  {
    id: 'data-activity',
    title: 'Data Migration and Activity Logs',
    keywords: ['data migration', 'import data', 'activity', 'audit', 'log', 'history', 'who changed'],
    body: 'Data Migration imports existing records into the app. Activity Logs is the audit trail: who did what and when, with before/after change snapshots, filters, and CSV export. Use it to review changes across the system.',
  },
  {
    id: 'ai-assistant',
    title: 'Using this AI Assistant',
    keywords: ['ai assistant', 'assistant', 'ai', 'chatbot', 'help', 'ask', 'how to use ai'],
    body: 'This assistant does two things: (1) answers questions about your live data (who owes rent, a tenant\'s balance, this month\'s expenses, open maintenance) by querying the real records, and (2) helps you learn and use the app (how-tos, where features are, training). Ask in plain English. For data questions it looks up the real numbers and never makes them up; for how-to questions it explains the steps. It is available to staff with the AI Assistant permission.',
  },
  {
    id: 'deposits-fees',
    title: 'Security deposits and move-in fees',
    keywords: ['deposit', 'security deposit', 'move-in fee', 'move in', 'fees', 'first month', 'holding'],
    body: 'When a tenant moves in you record their security deposit (held, not income) and any move-in fee (which IS income and generates a receipt) from the Tenant Profile. Both capture the amount, date, and method with an audit entry. Deposits are tracked separately so they are never counted as revenue and stay available to return at move-out.',
  },
  {
    id: 'deposit-returns',
    title: 'Returning a deposit at move-out',
    keywords: ['deposit return', 'return deposit', 'move out', 'refund deposit', 'deductions', 'move-out'],
    body: 'At move-out, record the deposit return with any deductions. The app tracks the return deadline, so it appears on the Dashboard "Deposits" tab as it approaches. A returned deposit is not an expense (it was never income); anything you keep for damages is handled as its own entry.',
  },
  {
    id: 'inspections',
    title: 'Inspections',
    keywords: ['inspection', 'inspections', 'walkthrough', 'condition', 'move-in inspection', 'move-out inspection'],
    body: 'Inspections live on the Tenant Profile. Record move-in, periodic, or move-out inspections with notes so you keep a documented condition history for each tenancy.',
  },
  {
    id: 'notices',
    title: 'Serving notices',
    keywords: ['notice', 'notices', 'eviction', 'late notice', 'legal notice', 'serve', 'pay or quit', 'violation'],
    body: 'Notices are recorded on the Tenant Profile to document formal communications (for example a pay-or-quit or lease-violation notice) with the date and type, keeping a paper trail alongside the tenancy.',
  },
  {
    id: 'documents-signing',
    title: 'Document templates and tenant e-signing',
    keywords: ['document', 'template', 'lease document', 'application', 'rules', 'sign', 'signing', 'e-sign', 'send document'],
    body: 'Settings > Templates is a library where you upload lease, application, and rules documents once. From a prospective tenant you can send a template with a picker; the tenant gets a secure no-login link to review and sign, their status advances automatically, and the signed copy is stored.',
  },
  {
    id: 'rent-receipts',
    title: 'Rent receipts',
    keywords: ['receipt', 'receipts', 'rent receipt', 'pdf', 'proof of payment'],
    body: 'When you manually record a paid rent payment, the app generates a PDF receipt automatically, saves it, and makes it available to the tenant in their portal Documents and as a per-payment download. Receipts use your company identity from Settings.',
  },
  {
    id: 'rent-spreadsheet',
    title: 'Master rent spreadsheet and Drive documents',
    keywords: ['spreadsheet', 'google sheet', 'drive', 'export rent', 'sync', 'master sheet', 'storage'],
    body: 'Tenant documents (receipts, signed leases) are stored in Google Drive, and a live-mirror master rent Google Sheet can be synced from the app for an at-a-glance ledger. If documents are not syncing, connect Drive from Settings.',
  },
  {
    id: 'utility-accounts',
    title: 'Utility accounts',
    keywords: ['utility', 'utilities', 'water', 'gas', 'electric', 'account number'],
    body: 'The Utilities area records the water, gas, and electric accounts you (the landlord) pay, per property, with the account details so they are easy to reference when you record a utility expense.',
  },
  {
    id: 'realtors',
    title: 'Realtors and available units',
    keywords: ['realtor', 'realtors', 'agent', 'referral', 'available units', 'listing', 'leasing'],
    body: 'You can invite a realtor to a limited portal where they see available units and the prospective tenants they refer, for a set window. Referred applicants can be tagged to their source. Realtors never see management data.',
  },
  {
    id: 'push-notifications',
    title: 'Tenant push notifications',
    keywords: ['push', 'phone alert', 'mobile notification', 'remind tenant', 'notify tenant'],
    body: 'Tenant push notifications are on by default and enable themselves on the tenant\'s first visit, so tenants get rent reminders and messages on their phone with no toggle to find. The platform only needs the tenant to allow notifications once.',
  },
  {
    id: 'login-security',
    title: 'Login, two-factor, and passwords',
    keywords: ['login', 'password', 'reset password', '2fa', 'two factor', 'security', 'sign in', 'forgot password'],
    body: 'Everyone signs in at the same login. Accounts support two-factor authentication (authenticator app or emailed code). A forgotten password is reset through a secure emailed link. New staff and tenants are onboarded with a personal set-password invite, never a shared password.',
  },
  {
    id: 'vacancy-loss',
    title: 'Vacancy loss',
    keywords: ['vacancy', 'vacant', 'vacancy loss', 'empty unit', 'lost rent'],
    body: 'When a unit has no active lease covering a month, the app tracks the lost rent as vacancy loss (with daily proration) and surfaces it on the Dashboard — showing the cost of empty units this month and year to date.',
  },
  {
    id: 'attention-tabs',
    title: 'Understanding the Dashboard "Needs Attention" tabs',
    keywords: ['needs attention', 'dashboard tabs', 'past due', 'overdue', 'contracts', 'vacant', 'deposits'],
    body: 'Past due = tenants with an unpaid balance for the current or an earlier month. Overdue = past due where the monthly due day has already passed. Deposits = deposit returns approaching their deadline. Contracts = active fixed-term leases by soonest expiry (month-to-month tenants have no end date, so they are not listed). Vacant = units with no lease covering this month.',
  },
  {
    id: 'rent-reminders',
    title: 'Automatic rent reminders and how tenants pay',
    keywords: ['rent reminder', 'due reminder', 'auto reminder', 'how to pay', 'payment instructions', 'remind rent'],
    body: 'A monthly rent-due reminder is emailed and pushed to active tenants automatically around the due day (set in Settings); it runs on its own schedule, separate from Email Campaigns. Your payment instructions, shown to tenants as "How to pay", are set in Settings so every reminder and portal tells tenants exactly how to pay.',
  },
  {
    id: 'troubleshoot-rent',
    title: 'Why a tenant shows no or unexpected rent owed',
    keywords: ['no rent', 'not showing', 'why owe', 'wrong balance', 'missing rent', 'troubleshoot', 'needs review'],
    body: 'Common reasons a tenant owes less than expected: rent tracking only starts January 2026 (nothing before counts); the lease is paused for that month; it is a pending/draft/rejected renewal (only approved renewals bill); the lease is flagged needs-review; an overpayment carried forward and covered the month; or the month falls before the lease start or after its end. The tenant profile shows the true current balance.',
  },
  {
    id: 'troubleshoot-vacant',
    title: 'Why a unit shows vacant',
    keywords: ['vacant', 'why vacant', 'unit empty', 'not occupied', 'occupancy wrong'],
    body: 'A unit shows vacant when no active lease covers the current month, even if a future lease exists. Check that the lease start date has arrived, the lease status is active (not ended or needs-review), and it is linked to the correct unit. Units you are holding or that are under maintenance are treated separately from ordinary vacancy.',
  },
];

/** A compact list of every help topic, for discovery / when nothing matches. */
export function helpTopicList(): string {
  return JSON.stringify({
    note: 'These are the app how-to / training topics available. Pass one as `topic` for details.',
    topics: HELP_ARTICLES.map((a) => a.title),
  });
}

/** Find the best-matching help article(s) for a question or topic. */
export function lookupHelp(rawQuery: string): string {
  const q = (rawQuery || '').toLowerCase();
  const tokens = q.split(/[^a-z0-9]+/).filter((t) => t.length > 2);
  if (tokens.length === 0) return helpTopicList();

  const scored: { a: HelpArticle; score: number }[] = [];
  for (const a of HELP_ARTICLES) {
    const title = a.title.toLowerCase();
    const hay = `${title} ${a.keywords.join(' ')} ${a.body}`.toLowerCase();
    let score = 0;
    for (const t of tokens) {
      if (title.includes(t)) score += 3;
      else if (a.keywords.some((k) => k.includes(t))) score += 2;
      else if (hay.includes(t)) score += 1;
    }
    if (score > 0) scored.push({ a, score });
  }
  scored.sort((x, y) => y.score - x.score);

  if (scored.length === 0) {
    return JSON.stringify({
      note: 'No specific article matched. Offer the user one of these topics.',
      topics: HELP_ARTICLES.map((a) => a.title),
    });
  }
  return JSON.stringify({
    articles: scored.slice(0, 2).map((s) => ({ title: s.a.title, content: s.a.body })),
    otherTopics: HELP_ARTICLES.filter((a) => !scored.slice(0, 2).some((s) => s.a.id === a.id)).map((a) => a.title),
  });
}
