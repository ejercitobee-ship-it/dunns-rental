import type { MaintenanceStatus } from '../types';

/** Human labels for the job lifecycle, shared by the admin page and portals. */
export const STATUS_LABEL: Record<MaintenanceStatus, string> = {
  submitted: 'Submitted',
  assigned: 'Assigned',
  scheduled: 'Scheduled',
  in_progress: 'In progress',
  completed: 'Completed',
  paid: 'Paid',
  cancelled: 'Cancelled',
};

type BadgeVariant = 'warning' | 'default' | 'success' | 'secondary' | 'destructive';

export const STATUS_BADGE: Record<MaintenanceStatus, BadgeVariant> = {
  submitted: 'warning',
  assigned: 'default',
  scheduled: 'default',
  in_progress: 'default',
  completed: 'success',
  paid: 'success',
  cancelled: 'secondary',
};

/** Trade slug to label. HVAC stays upper; the rest are simple title case. */
export const TRADE_LABEL: Record<string, string> = {
  plumbing: 'Plumbing',
  electrical: 'Electrical',
  hvac: 'HVAC',
  appliance: 'Appliance',
  carpentry: 'Carpentry',
  general: 'General',
  other: 'Other',
};

export function tradeLabel(slug?: string): string {
  if (!slug) return 'General';
  return TRADE_LABEL[slug] ?? slug.charAt(0).toUpperCase() + slug.slice(1);
}

/** Statuses that are still open work (not paid or cancelled). */
export function isActiveStatus(status: MaintenanceStatus): boolean {
  return status !== 'paid' && status !== 'cancelled';
}

/**
 * The approval-oriented badge for a job that is in the report → approve → pay
 * flow: Pending approval, Approved, or Paid. Returns null for jobs outside that
 * flow, where the normal STATUS badge should be shown instead.
 */
export function approvalBadge(
  m: { needsApproval?: boolean; approvedAt?: string; status: MaintenanceStatus }
): { label: string; variant: BadgeVariant } | null {
  if (m.status === 'paid') return { label: 'Paid', variant: 'success' };
  if (m.needsApproval) return { label: 'Pending approval', variant: 'warning' };
  if (m.approvedAt) return { label: 'Approved', variant: 'default' };
  return null;
}
