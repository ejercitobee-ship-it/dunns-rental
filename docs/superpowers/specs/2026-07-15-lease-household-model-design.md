# Lease and household model

Date: 2026-07-15
Status: approved, ready for implementation plan
Project: A of three (A: this. B: Google Drive folders. C: tenant portal.)

## Why

Today rent lives on each tenant record, and revenue adds up every active tenant's
rent. The moment a second person is added to a unit, income double counts. The
model simply cannot express "two adults, one lease, one rent."

That blocks the goal of recording everyone who lives in a unit. It also blocks the
next two projects: Google Drive folders and the tenant portal both need a person
to have one stable identity over time.

Production currently holds 1 property and 6 units, with zero tenants, zero
payments and zero documents. Fixing the model now costs almost nothing. Doing it
after real tenant data is entered would be a painful migration.

## Decisions

Taken from the design conversation with Belle:

1. Rent belongs to the unit's tenancy, not to a person. One rent per lease.
2. Payments must record who paid. Money arrives either as one full payment or
   split across several people. Both must work.
3. Track everyone who lives in the unit. No leaseholder versus occupant
   distinction, no roles to maintain.
4. Keep lease history so tax figures stay truthful, but keep the interface
   focused on who lives there now. History is a detail view, not a feature.
5. Chosen approach: a real lease record. Rejected: a lighter "household"
   grouping (history stays fuzzy, likely rework for the portal) and putting rent
   on the unit (no honest place for lease terms or past tenancies).

## Data model

**leases** (new)
: `id`, `unit_id`, `property_id`, `start_date`, `end_date`, `monthly_rent`,
  `security_deposit`, `status` (`active` | `paused` | `ended`), `notes`,
  `created_at`, `updated_at`.
  Owns all money, dates and state for a tenancy on one unit. "Pause rent" and
  "terminate lease" act on the lease, because they are things that happen to a
  tenancy rather than to a person. Only `active` leases count toward revenue.

**tenants** (people, reshaped)
: `id`, `first_name`, `last_name`, `email`, `phone`, emergency contact fields,
  `notes`, timestamps.
  The `monthly_rent`, `security_deposit`, `lease_start`, `lease_end`, `unit_id`,
  `property_id` and `status` columns are removed. A person is only a person. A
  person is "current" when they are on an active lease, which is derived rather
  than stored, so the two cannot disagree.

**lease_tenants** (new join)
: `id`, `lease_id`, `tenant_id`, `created_at`. Unique on (`lease_id`, `tenant_id`).
  A lease has many people. A person may appear on many leases over time, through
  a renewal or a move to another unit, while remaining the same person. This is
  what later gives them one login and one Drive folder.

**rent_payments** (reshaped)
: `lease_id` replaces `tenant_id` as the thing that owes rent.
  `paid_by_tenant_id` (nullable) records who the money came from.
  Keeps `amount`, `due_date`, `paid_date`, `received_date`, `month`, `year`,
  `status`, `payment_method`, `notes`.

**documents** (unchanged)
: Stays attached to `tenant_id` (the person) and/or `property_id`. Person
  identity is stable, so documents follow the person across leases.

### Rules

- A month is settled when payments recorded for that lease, month and year sum to
  the lease's `monthly_rent`. Less than that is partial, and the balance is shown.
- Revenue is the sum of `monthly_rent` across active leases. It is counted once
  regardless of how many people live in the unit. This is the double-count fix.
- Turnover: mark the lease `ended`. It keeps its rent, dates and payments intact.
  Create a new lease on the same unit.

## Application changes

- **Tenants page**: lists people. Each row opens an individual person page showing
  their details, documents, housemates, unit, lease term and payment history.
- **Add tenancy flow**: choose a unit, set the tenancy once (start, end, monthly
  rent, deposit), then add one or more people, each with their own contact and
  emergency contact.
- **Unit view**: shows the current tenancy and everyone living in it.
- **Rent Management**: rent is per lease per month. Recording a payment asks who
  paid and how much. Multiple payments per month are allowed and settle the month
  when they add up.
- **Dashboard, Reports, Tax Report**: compute from active leases rather than per
  tenant. Rent roll shows one row per unit with occupants listed.

## Rollout

- No data migration. Production has no tenants, payments or documents.
- Belle will not add tenants to the live site until this ships.
- Work happens on the `lease-household-model` branch. The live site is untouched
  until the change is verified locally and deployed in one step.

## Verification

Money math is where a bug would actually hurt, so each is checked rather than
assumed:

1. Create a tenancy with two people. Revenue counts the rent once, not twice.
2. Split a month across two payments. The month settles when they add up.
3. Record a short payment. The month shows partial with the correct balance.
4. One person pays in full. The month settles.
5. End a lease and start a new one on the same unit. History and tax figures stay
   correct.
6. Dashboard, Rent Management, Reports and Tax Report all agree with each other.

## Out of scope

- **B**: Google Drive folder per tenant, with uploads filed automatically.
- **C**: Tenant portal, where a tenant signs in and sees only their own
  information, payment history and documents.

Both depend on the person identity established here.
