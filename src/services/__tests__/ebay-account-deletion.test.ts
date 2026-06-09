import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { processEbayAccountDeletionNotification } from '../ebay-account-deletion.js';

const auditPath = join(tmpdir(), `vaultr-ebay-deletion-${Date.now()}.log`);

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.EBAY_DELETION_AUDIT_PATH;
  if (existsSync(auditPath)) rmSync(auditPath);
});

describe('processEbayAccountDeletionNotification', () => {
  it('ignores non-object and unrelated payloads', () => {
    process.env.EBAY_DELETION_AUDIT_PATH = auditPath;

    expect(processEbayAccountDeletionNotification(null)).toBe(false);
    expect(processEbayAccountDeletionNotification({ metadata: { topic: 'OTHER_TOPIC' } })).toBe(false);
    expect(existsSync(auditPath)).toBe(false);
  });

  it('audit-logs valid marketplace account deletion notifications with masked user ids', () => {
    process.env.EBAY_DELETION_AUDIT_PATH = auditPath;
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    expect(processEbayAccountDeletionNotification({
      metadata: { topic: 'MARKETPLACE_ACCOUNT_DELETION' },
      notification: {
        notificationId: 'notification-1',
        eventDate: '2026-06-09T00:00:00.000Z',
        data: { userId: 'abcdef123456' }
      }
    })).toBe(true);

    const line = readFileSync(auditPath, 'utf-8').trim();
    expect(line).toContain('notification-1');
    expect(line).toContain('ab***56');
    expect(line).not.toContain('abcdef123456');
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('userId=ab***56'));
  });
});