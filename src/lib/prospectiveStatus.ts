import type { ProspectiveStatus } from './api';

/** Label and badge colour for each applicant stage. */
export const PROSPECTIVE_STATUS: Record<ProspectiveStatus, { label: string; variant: 'secondary' | 'warning' | 'success' | 'destructive' }> = {
  applied: { label: 'Applied', variant: 'secondary' },
  docs_sent: { label: 'Docs sent', variant: 'warning' },
  signed: { label: 'Signed', variant: 'success' },
  converted: { label: 'Converted', variant: 'success' },
  rejected: { label: 'Rejected', variant: 'destructive' },
};
