import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
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

function appendAuditLine(filePath: string, line: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  appendFileSync(filePath, `${line}\n`, { encoding: 'utf-8' });
}

function auditContainsNotification(filePath: string, notificationId: string): boolean {
  if (!existsSync(filePath)) return false;
  try {
    return readFileSync(filePath, 'utf-8').split('\n').some((line) => {
      if (!line.trim()) return false;
      try {
        const record = JSON.parse(line) as { notificationId?: unknown };
        return record.notificationId === notificationId;
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
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
  const username = stringField(notificationData?.username);
  const userId = stringField(notificationData?.userId);
  const eiasToken = stringField(notificationData?.eiasToken);

  const deletionAuditPath = process.env.EBAY_DELETION_AUDIT_PATH ?? './data/ebay-deletions.log';
  if (notificationId !== 'unknown' && auditContainsNotification(deletionAuditPath, notificationId)) {
    console.log(`[eBay deletion] duplicate acknowledged notificationId=${notificationId}`);
    return true;
  }
  const auditRecord = JSON.stringify({
    processedAt: new Date().toISOString(),
    topic,
    notificationId,
    eventDate,
    identifiersPresent: {
      username: Boolean(username),
      userId: Boolean(userId),
      eiasToken: Boolean(eiasToken)
    },
    action: 'NO_CORRELATABLE_EBAY_ACCOUNT_IDENTIFIER_STORED'
  });
  appendAuditLine(deletionAuditPath, auditRecord);

  console.log(`[eBay deletion] processed notificationId=${notificationId} action=NO_CORRELATABLE_EBAY_ACCOUNT_IDENTIFIER_STORED`);
  return true;
}
