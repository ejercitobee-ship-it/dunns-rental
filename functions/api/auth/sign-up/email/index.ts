import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, jsonError } from '../../../../lib/session';

/**
 * POST /api/auth/sign-up/email — disabled.
 *
 * Access to this app is invite only. Accounts are created by an admin (team
 * members from the Users page) or through a branded invite (tenants, realtors,
 * handymen). No one can self-register, so this endpoint always refuses.
 */
export const onRequestPost: PagesFunction<Env> = async () => {
  return jsonError('Sign up is disabled. Access to this app is invite only.', 403);
};
