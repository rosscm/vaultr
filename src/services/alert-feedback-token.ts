import { createHash } from 'node:crypto';

export function makeAlertFeedbackToken(chaseId: string, listingId: string): string {
  return createHash('sha256').update(`${chaseId}:${listingId}`).digest('base64url').slice(0, 16);
}
