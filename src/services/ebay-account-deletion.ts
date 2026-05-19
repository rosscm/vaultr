import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

type DeletionNotification = {
  metadata?: {
    topic?: string;
    schemaVersion?: string;
    deprecated?: boolean;
  };
  notification?: {
    notificationId?: string;
    eventDate?: string;
    publishDate?: string;
    publishAttemptCount?: number;
    data?: {
      username?: string;
      userId?: string;
      eiasToken?: string;
    };
  };
};

function maskValue(value: string): string {
  if (value.length <= 4) return '****';
  return `${value.slice(0, 2)}***${value.slice(-2)}`;
}

function appendAuditLine(filePath: string, line: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  appendFileSync(filePath, `${line}\n`, { encoding: 'utf-8' });
}

export function processEbayAccountDeletionNotification(payload: unknown): void {
  const data = payload as DeletionNotification;
  const topic = data?.metadata?.topic;
  if (topic !== 'MARKETPLACE_ACCOUNT_DELETION') return;

  const notificationId = data?.notification?.notificationId ?? 'unknown';
  const eventDate = data?.notification?.eventDate ?? new Date().toISOString();
  const userId = data?.notification?.data?.userId ?? 'unknown';
  const maskedUserId = maskValue(userId);

  // Vaultr currently stores no personal eBay account data. We still keep an
  // audit record proving deletion events were received and processed.
  const deletionAuditPath = process.env.EBAY_DELETION_AUDIT_PATH ?? './data/ebay-deletions.log';
  const auditRecord = JSON.stringify({
    processedAt: new Date().toISOString(),
    topic,
    notificationId,
    eventDate,
    maskedUserId,
    action: 'NO_PERSONAL_EBAY_DATA_STORED'
  });
  appendAuditLine(deletionAuditPath, auditRecord);

  console.log(`[eBay deletion] processed notificationId=${notificationId} userId=${maskedUserId}`);
}
