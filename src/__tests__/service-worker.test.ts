import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

describe('Web Push service worker', () => {
  it('keeps collector Discord delivery out of the polling path', () => {
    const poller = fs.readFileSync(path.resolve('src/services/poller.ts'), 'utf8');
    expect(poller).not.toContain('processPendingDiscordAlertDeliveries');
    expect(poller).not.toContain('sendDiscordDirectMessage');
    expect(poller).toContain('enqueueWebPushForAlert');
  });

  it('shows privacy-safe notifications and opens the exact Inbox deep link', async () => {
    const listeners = new Map<string, (event: Record<string, unknown>) => void>();
    const showNotification = vi.fn().mockResolvedValue(undefined);
    const navigate = vi.fn().mockResolvedValue(undefined);
    const focus = vi.fn().mockResolvedValue(undefined);
    const client = { url: 'https://keepseek.test/app#home', navigate, focus };
    const worker = {
      location: { origin: 'https://keepseek.test' },
      registration: { showNotification },
      clients: {
        matchAll: vi.fn().mockResolvedValue([client]),
        openWindow: vi.fn()
      },
      addEventListener: (name: string, listener: (event: Record<string, unknown>) => void) => listeners.set(name, listener)
    };
    const source = fs.readFileSync(path.resolve('web/service-worker.js'), 'utf8');
    new Function('self', source)(worker);

    let pushWork: Promise<unknown> | undefined;
    listeners.get('push')?.({
      data: { json: () => ({
        title: 'New Watchlist match!',
        body: 'KeepSeek found a new match for one of your Watchlist cards.',
        path: '/app#alerts?alertId=alert-123'
      }) },
      waitUntil: (work: Promise<unknown>) => { pushWork = work; }
    });
    await pushWork;
    expect(showNotification).toHaveBeenCalledWith('New Watchlist match!', expect.objectContaining({
      body: 'KeepSeek found a new match for one of your Watchlist cards.',
      data: { path: '/app#alerts?alertId=alert-123' }
    }));

    let clickWork: Promise<unknown> | undefined;
    const close = vi.fn();
    listeners.get('notificationclick')?.({
      notification: { close, data: { path: '/app#alerts?alertId=alert-123' } },
      waitUntil: (work: Promise<unknown>) => { clickWork = work; }
    });
    await clickWork;
    expect(close).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith('https://keepseek.test/app#alerts?alertId=alert-123');
    expect(focus).toHaveBeenCalledOnce();
  });
});
