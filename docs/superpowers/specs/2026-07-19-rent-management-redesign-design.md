# Rent Management Redesign — Design

**Date:** 2026-07-19
**Status:** Approved for planning
**Author:** Belle + Claude

## Goal

Cut the Rent Management Payments tab from a ~120-row wall (every lease × all 12 months) down to a short, scannable list: one collapsible row per tenant, whoever owes sorted to the top, driven by search. Reduce how overwhelming the page feels without changing a single number or how rent is stored.

## Problem

The Payments tab renders `leaseMonthRows`: one row per lease per month for all 12 months of the selected year. With ~10 active leases that is ~120 rows, most of them past months already marked Paid. Belle named this "the huge table of rows" as the single biggest source of overwhelm, and asked to lean on the search bar to reach a specific tenant instead of seeing everyone at once.

## Decisions (locked with Belle)

- **One row per tenant, collapsed.** Each active lease is a single line labeled by its occupant name(s), so a lease shared by two people is one row (rent is never double-counted — it lives on the lease, per the lease model). For a single-occupant lease it reads exactly as "one row per tenant".
- **Always flag overdue.** Every collapsed row shows this month's status and, whenever the tenant owes from earlier elapsed months, a red "$X overdue" flag. Overdue is never hidden.
- **Collapsed until clicked.** Nothing auto-expands. Clicking a row reveals that one tenant's month-by-month detail for the year.
- **Sorted so action is on top.** Rows that need attention (owe this month, or overdue) sort above fully-paid rows; fully-paid rows are lightly dimmed at the bottom.
- **Search is the main way in.** The existing search (name / unit / property) filters the collapsed list.
- **Only the Payments tab changes.** Annual Overview and Tax Report tabs stay exactly as they are. The year picker, 4 summary cards, Import/Export, and the "Needs review" card all stay.
- **No data-model change.** Same settlement math (`settleMonth`, `leasesOwingMonth`), same stored payments. This is layout only.

## Non-goals

- No change to how rent due/paid/balance is computed or stored.
- No change to the Annual Overview or Tax Report tabs, the Record Payment modal, the Import/Export flow, or the Needs review card.
- No new API endpoint. The page already loads leases, payments, units, properties, tenants from `useApp()`.

---

## The new Payments tab

### Grouping

Group today's `leaseMonthRows` by `lease.id`. Each group becomes one **tenant row** carrying:

- `lease`, `unit`, `property`, `occupants` (from the group; all rows in a group share these).
- `monthRows`: the group's per-month settlements, sorted by month ascending.
- **This month's settlement:** the `monthRows` entry for the current month *when the selected year is the current year*. For a past year there is no "this month", so the row's headline status falls back to the year's most recent owed month. For a future year, there is no elapsed month — headline shows "Upcoming", no overdue flag.
- **Overdue amount:** sum of `settlement.balance` across the group's **elapsed** months only (months ≤ today for the current year; all 12 for a past year; none for a future year). Excludes the current month's balance from the "overdue" figure — the current month is shown as its own status, not as overdue.

### The collapsed row (one per tenant)

Left to right:

- Chevron (right = collapsed, down = expanded).
- Tenant name(s) (occupants joined by " & ", or "—" if none) and, beneath, `Property · Unit`.
- Status pills: this month's status (Paid / Partial / Unpaid, current year only), plus a red "$X overdue" pill whenever the overdue amount > 0.
- A "Record" button (only when there is a current, unpaid/partial month to record against) that opens the existing Record Payment modal for this month — the quick path for the common case.

### The expanded detail (on click)

Reuses today's per-month presentation, scoped to this one lease: the group's `monthRows` for the year, each showing period, due, paid, balance, status, and a per-month Record button for unpaid/partial months. This is the same information the current flat table shows, just one tenant at a time.

Expansion is client-side state (a set of expanded lease ids). Collapsed by default.

### Sorting

Tenant rows sort by: needs-attention first (has overdue OR this month unpaid/partial), then by property name, then unit number. Fully-paid rows render after, at reduced opacity.

### Search

Unchanged in behavior: filter the tenant rows by occupant name, unit number, or property name. Filtering operates on the grouped rows.

### Empty state

When no tenant rows match (search or year), show the existing empty-state card.

---

## Files touched

**Modify:** `src/pages/Rents.tsx` — replace the flat Payments table (the `view === 'payments'` block's table) with the grouped, collapsible tenant list. Add a `groupedRows` memo (deriving from the existing `leaseMonthRows`/`filteredRows`) and an `expandedLeaseIds` state set. Keep everything else in the file (memos, modals, import/export, other tabs) intact.

**Possibly extract:** if the grouping logic is more than a small memo, pull a pure `groupLeaseMonthRows(rows, year)` helper into `src/lib/rent.ts` (where `settleMonth`/`leasesOwingMonth` live) and unit-test it there. Prefer this if it keeps `Rents.tsx` readable.

## Testing

- **Pure logic (if extracted):** `groupLeaseMonthRows` — one group per lease, occupants carried through, this-month status picked correctly for current vs past vs future year, overdue sum excludes the current month and future months, needs-attention sort order. Unit-tested in `src/lib/rent.test.ts`.
- **Manual / behavioral:** with the current year selected, a fully-paid tenant is collapsed, dimmed, at the bottom, no overdue pill; a tenant unpaid this month is at the top with an Unpaid pill and a Record button; a tenant with a prior unpaid month shows the "$X overdue" pill; clicking a row expands only that tenant's months; recording a payment from the collapsed row and from an expanded month both work and update the row; search narrows to matching tenants; a past year shows no "Record"/upcoming oddities; Annual Overview and Tax Report tabs are unchanged.

## Rollout

Layout-only change on `feature/rent-management-redesign` (branched off `main`, independent of the rent-spreadsheet branch). No migration. Deploy = merge to `main` + push (Cloudflare auto-deploys). Verify in a real browser after deploy.
