# Tenant and realtor portal

Date: 2026-07-16
Status: design under review with Belle
Project: C of the original vision (tenant access), plus a new realtor role

## Why

Tenants have no way to see their own information. Everything lives in the
management app behind Belle's login, so a tenant who wants their payment history
or a copy of a document has to ask her, and a detail entered wrong at move in
stays wrong until she fixes it.

Realtors place tenants in the apartments and then have no way to hand over
paperwork, so documents arrive by text and email and get filed by hand.

Both are outsiders. Neither should ever reach the books, the expenses, or another
tenant's file.

## Decisions

From the design conversation with Belle:

1. **A separate portal area**, walled off from the management app. Tenants and
   realtors never load a management page, and the wall is enforced on the server,
   not by hiding links.
2. **Tenants are invited by email.** Belle clicks Invite on a tenant, they get a
   link to set their own password.
3. **A tenant may edit everything about themselves**, and upload documents.
4. **A tenant sees the lease total, not who paid.** On a shared rent they see
   what is due, what is paid, and the balance, but not which housemate paid what.
5. **Realtors are linked to a tenant after the fact**, by Belle, from the
   tenant's page. This works for tenants already living there.
6. **A realtor's access lapses 30 days after move in.**
7. **A realtor sees everything on their linked tenant**, including documents the
   tenant uploaded.
8. **A realtor may view and upload documents only.** They may not edit anything.

### Two things that follow from the decisions

**Editing "everything about themselves" is safe by construction.** Since the
lease work, a tenant record holds only the person: name, email, phone and
emergency contact. Rent, unit and lease dates live on the lease. A tenant
editing their own record cannot touch money or lease terms because those fields
are not on the record they can reach.

**`tenants.notes` is excluded.** That field reads as Belle's private notes about
a tenant. It is not shown to the tenant and not editable by them, and it is not
shown to realtors.

### The window rule, resolving a conflict

Belle chose both "link the realtor afterwards" and "30 days after move in".
Those collide: linking a realtor to someone who moved in six months ago would
grant nothing. The rule is therefore:

> A realtor's access to a tenant ends 30 days after the tenancy start date, or
> 30 days after the link was created, whichever is later.

Linking always grants a usable window, and access still lapses on its own.

### Disclosure

A realtor sees documents the tenant uploaded. The tenant is told so plainly on
their upload screen: their realtor can see what they upload for the first 30
days. Nobody is surprised by a third party reading their paperwork.

## Prerequisite, outside the code

Invites are email. Resend currently delivers only to `info@mhdunnproperty.net`
because the sending domain is unverified, so **`mhdunnproperty.net` must be
verified in Resend (a DNS step) before a single invite can reach a tenant.**
Until then the portal can be built and tested, but not rolled out. Belle does
this when she is ready; it is not a code task.

## Data model

**`tenants.user_id`** already exists and is unused. It becomes the link between a
person and their login. One tenant record, one user account.

**`tenant_realtors`** (new): `id`, `tenant_id`, `realtor_user_id`, `created_at`.
Unique on (`tenant_id`, `realtor_user_id`). The link Belle creates. Access is
derived from this plus the lease start date and the window rule above; nothing
stores an expiry, so the rule cannot drift from the data.

**Roles**: two new roles, `tenant` and `realtor`, alongside the existing five.
They carry no management permissions at all. Their access is not expressed as
permissions on the management resources; it is expressed by the portal endpoints
scoping every query to the caller.

**`documents`** already has `tenant_id`. It gains `uploaded_by_user_id` so an
upload can be attributed to the tenant, a realtor, or Belle.

## Architecture

### The wall

Portal pages live under `/portal/*` with their own layout. They never mount the
management `Layout`, its sidebar, or its context.

The wall that matters is on the server. Every portal endpoint lives under
`functions/api/portal/` and follows one rule:

> Resolve the caller's own tenant (or their linked tenants) from the session.
> Never accept a tenant id, lease id, or document id from the client and trust it.

A tenant asking for a document supplies its id; the endpoint confirms that
document belongs to the tenant resolved from the session before returning a byte
of it. The same applies to a realtor, whose reachable set is the tenants linked
to them and still inside the window.

Management endpoints stay as they are and gain nothing. A `tenant` or `realtor`
role holds no management permissions, so `requirePermission` already refuses
them. The portal is additive.

### Routing

- `/portal` and below: the portal, for `tenant` and `realtor` roles.
- A `tenant` or `realtor` who lands on a management route is sent to `/portal`.
- A staff member who lands on `/portal` is sent to the dashboard.
- Login is shared. After sign in, role decides where you land.

### Pages

**Tenant**
- Home: their unit, their lease term and rent, and this month's status.
- Payments: month by month for their lease. Due, paid, balance, status. No
  per person breakdown, per the decision above.
- My information: their person record, editable, plus emergency contact.
- Documents: what is on file for them, and an upload, with the realtor
  disclosure.

**Realtor**
- My tenants: the tenants linked to them and inside the window, with the unit
  they were placed in.
- Tenant detail: that tenant's information, read only, and their documents.
- Upload: add a document to that tenant.
- A tenant whose window has closed simply is not listed and is not reachable.

## Verification

The security rules are the product here, so they are tested, not eyeballed:

1. A tenant cannot read another tenant's record, documents, or payments, by id
   or otherwise.
2. A tenant cannot reach any management endpoint.
3. A tenant cannot change their own rent, lease, or unit, and cannot see or set
   `notes`.
4. A realtor sees exactly their linked tenants, and only inside the window.
5. A realtor one day past the window sees nothing, and their direct links 404.
6. A realtor cannot edit a tenant, and cannot reach a tenant they never placed.
7. On a shared lease, neither tenant sees who paid what.
8. Staff pages and figures are unchanged for staff.

## Out of scope

- Tenants paying rent online. Money in is unchanged.
- Tenants submitting maintenance requests.
- Messaging between anyone.
- Realtors creating tenants or tenancies.
- Any change to how staff use the app today.
