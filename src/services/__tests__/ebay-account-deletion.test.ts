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

  it('audit-logs valid notifications without retaining supplied account identifiers', () => {
    process.env.EBAY_DELETION_AUDIT_PATH = auditPath;
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    expect(processEbayAccountDeletionNotification({
      metadata: { topic: 'MARKETPLACE_ACCOUNT_DELETION' },
      notification: {
        notificationId: 'notification-1',
        eventDate: '2026-06-09T00:00:00.000Z',
        data: { username: 'seller-name', userId: 'abcdef123456', eiasToken: 'legacy-token' }
      }
    })).toBe(true);

    const line = readFileSync(auditPath, 'utf-8').trim();
    expect(line).toContain('notification-1');
    expect(line).toContain('NO_CORRELATABLE_EBAY_ACCOUNT_IDENTIFIER_STORED');
    expect(line).toContain('"username":true');
    expect(line).not.toContain('abcdef123456');
    expect(line).not.toContain('seller-name');
    expect(line).not.toContain('legacy-token');
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('action=NO_CORRELATABLE_EBAY_ACCOUNT_IDENTIFIER_STORED'));
  });

  it('acknowledges duplicate notifications idempotently without duplicating audit records', () => {
    process.env.EBAY_DELETION_AUDIT_PATH = auditPath;
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const payload = {
      metadata: { topic: 'MARKETPLACE_ACCOUNT_DELETION' },
      notification: { notificationId: 'notification-duplicate', data: { userId: 'immutable-id' } }
    };

    expect(processEbayAccountDeletionNotification(payload)).toBe(true);
    expect(processEbayAccountDeletionNotification(payload)).toBe(true);
    expect(readFileSync(auditPath, 'utf-8').trim().split('\n')).toHaveLength(1);
    expect(logSpy).toHaveBeenLastCalledWith('[eBay deletion] duplicate acknowledged notificationId=notification-duplicate');
  });

  it('records an accurate conservative outcome when no correlatable identifier is supplied', () => {
    process.env.EBAY_DELETION_AUDIT_PATH = auditPath;
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    expect(processEbayAccountDeletionNotification({
      metadata: { topic: 'MARKETPLACE_ACCOUNT_DELETION' },
      notification: { notificationId: 'notification-no-identifiers', data: {} }
    })).toBe(true);
    const record = JSON.parse(readFileSync(auditPath, 'utf-8').trim());
    expect(record).toMatchObject({
      identifiersPresent: { username: false, userId: false, eiasToken: false },
      action: 'NO_CORRELATABLE_EBAY_ACCOUNT_IDENTIFIER_STORED'
    });
  });
});
