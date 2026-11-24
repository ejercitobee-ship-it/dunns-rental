-- Email template library for the Email Campaign & Reminder system (Phase 1).
-- Reusable, editable email templates with {{personalization}} variables.
CREATE TABLE IF NOT EXISTS email_templates (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  category     TEXT NOT NULL DEFAULT 'custom',
  subject      TEXT NOT NULL DEFAULT '',
  preview_text TEXT,
  body_html    TEXT NOT NULL DEFAULT '',
  is_system    INTEGER NOT NULL DEFAULT 0,  -- seeded starter templates
  created_by   TEXT,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at   INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_email_templates_cat ON email_templates(category, name);

-- Starter templates. Editable and duplicable; they never auto-send.
INSERT OR IGNORE INTO email_templates (id, name, category, subject, preview_text, body_html, is_system) VALUES
  ('tmpl_rent_due', 'Rent Due Reminder', 'rent',
   'Friendly reminder: your rent is due soon', 'A quick heads-up before your rent is due',
   '<p>Hi {{first_name}},</p><p>This is a friendly reminder that your rent of <strong>{{rent_amount}}</strong> for {{unit_number}} at {{property_name}} is due on <strong>{{payment_due_date}}</strong>.</p><p>You can pay anytime from your tenant portal: {{tenant_portal_link}}</p><p>Thank you,<br>{{management_company_name}}</p>', 1),
  ('tmpl_rent_overdue', 'Rent Past Due Notice', 'late_fee',
   'Your rent is past due', 'Your rent payment is now overdue',
   '<p>Hi {{first_name}},</p><p>Our records show an outstanding balance of <strong>{{balance_due}}</strong> for {{unit_number}} at {{property_name}}. Rent was due on {{payment_due_date}}.</p><p>Please pay as soon as possible to avoid additional late fees. You can pay here: {{tenant_portal_link}}</p><p>If you have already paid, thank you, and please disregard this notice.</p><p>{{management_company_name}} &middot; {{management_phone}}</p>', 1),
  ('tmpl_balance', 'Outstanding Balance Reminder', 'rent',
   'A note about your account balance', 'You have an outstanding balance',
   '<p>Hi {{first_name}},</p><p>Your current balance is <strong>{{balance_due}}</strong>. Please review your account and reach out if you have any questions.</p><p>Pay online: {{tenant_portal_link}}</p><p>{{management_company_name}}</p>', 1),
  ('tmpl_payment_received', 'Payment Received', 'payment',
   'We received your payment', 'Thank you — your payment is in',
   '<p>Hi {{first_name}},</p><p>We have received your payment for {{unit_number}} at {{property_name}}. Thank you!</p><p>You can view your payment history anytime in your portal: {{tenant_portal_link}}</p><p>{{management_company_name}}</p>', 1),
  ('tmpl_maint_scheduled', 'Maintenance Scheduled', 'maintenance',
   'Maintenance scheduled for your unit', 'We have scheduled maintenance',
   '<p>Hi {{first_name}},</p><p>We have scheduled maintenance for {{unit_number}} at {{property_name}}. Our team will be in touch to confirm a time.</p><p>Details: {{maintenance_description}}</p><p>{{management_company_name}} &middot; {{management_phone}}</p>', 1),
  ('tmpl_maint_done', 'Maintenance Completed', 'maintenance',
   'Your maintenance request is complete', 'The work is finished',
   '<p>Hi {{first_name}},</p><p>The maintenance work for {{unit_number}} at {{property_name}} is now complete. Thank you for your patience.</p><p>If anything still needs attention, reply to this email or submit a new request in your portal: {{tenant_portal_link}}</p><p>{{management_company_name}}</p>', 1),
  ('tmpl_inspection', 'Property Inspection Notice', 'inspection',
   'Upcoming inspection of your unit', 'Advance notice of an inspection',
   '<p>Hi {{first_name}},</p><p>This is advance notice that we will be conducting an inspection of {{unit_number}} at {{property_name}}. We will confirm the date and time with you shortly.</p><p>Please contact us with any questions.</p><p>{{management_company_name}} &middot; {{management_phone}}</p>', 1),
  ('tmpl_lease_renewal', 'Lease Renewal Reminder', 'lease',
   'Time to renew your lease', 'Your lease is coming up for renewal',
   '<p>Hi {{first_name}},</p><p>Your lease for {{unit_number}} at {{property_name}} ends on <strong>{{lease_end_date}}</strong>. We would love to have you stay.</p><p>Please reach out to discuss renewal options.</p><p>{{management_company_name}} &middot; {{management_phone}}</p>', 1),
  ('tmpl_welcome', 'Move-in Welcome', 'welcome',
   'Welcome to your new home', 'Welcome — we are glad to have you',
   '<p>Hi {{first_name}},</p><p>Welcome to {{property_name}}! We are delighted to have you in {{unit_number}}.</p><p>Set up your tenant portal to pay rent, submit maintenance requests, and see announcements: {{tenant_portal_link}}</p><p>Warm regards,<br>{{management_company_name}}</p>', 1),
  ('tmpl_general', 'General Tenant Announcement', 'general',
   'A note from {{management_company_name}}', 'An update for all residents',
   '<p>Hi {{first_name}},</p><p>Write your announcement here.</p><p>{{management_company_name}} &middot; {{management_phone}}</p>', 1);
