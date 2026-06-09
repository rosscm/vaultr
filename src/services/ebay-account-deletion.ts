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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

export function processEbayAccountDeletionNotification(payload: unknown): boolean {
  if (!isRecord(payload)) return false;
  const data = payload as DeletionNotification;
  const topic = data?.metadata?.topic;
  if (topic !== 'MARKETPLACE_ACCOUNT_DELETION') return false;

  const notification = isRecord(data.notification) ? data.notification : undefined;
  const notificationData = isRecord(notification?.data) ? notification.data : undefined;

  const notificationId = stringField(notification?.notificationId) ?? 'unknown';
  const eventDate = stringField(notification?.eventDate) ?? new Date().toISOString();
  const userId = stringField(notificationData?.userId) ?? 'unknown';
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
  return true;
}
