import { afterEach, describe, expect, it, vi } from 'vitest';
import { start } from '../start.js';
import { removeAllChases, setUserAlertSettings, setUserPlan } from '../../services/chase-store.js';
import { db } from '../../services/db.js';

const testUserIds = new Set<string>();

function testUserId(label: string): string {
  const userId = `start-${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  testUserIds.add(userId);
  return userId;
}

afterEach(() => {
  for (const userId of testUserIds) {
    removeAllChases(userId);
    db.prepare('DELETE FROM user_alert_settings WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM user_plans WHERE user_id = ?').run(userId);
  }
  testUserIds.clear();
});

describe('start command', () => {
  it('keeps onboarding focused and sends plan details to plan view', async () => {
    const userId = testUserId('onboarding');
    setUserPlan(userId, 'PRO');
    setUserAlertSettings(userId, { minScore: 92, alertCurrency: 'CAD' });

    const reply = vi.fn(async (_payload: any) => undefined);

    await start.execute({
      user: { id: userId },
      reply
    });

    const payload = reply.mock.calls[0]?.[0];
    const data = payload.embeds[0].toJSON();
    const text = [data.title, data.description].join('\n');

    expect(data.title).toBe('🏁 Vaultr Quick Start');
  expect(text).toContain('**Welcome to Vaultr!**');
    expect(text).toContain('Start with one card you want Vaultr to watch.');
    expect(text).toContain('Your chases shape better alerts now and help Vaultr learn what to show you next in your Weekly Shelf. 🔮');
    expect(text).toContain('**Step 1:** Add your first chase with `/chase add`; include the set number or variant when you know it');
    expect(text).not.toContain('promo stamp');
    expect(text).toContain('**Step 2:** Tune confidence, currency, and source controls with `/alerts settings`');
    expect(text).toContain('**Step 3:** Watch DMs for chase alerts and check your server’s Vaultr channel for fresh collector picks in your Weekly Shelf');
    expect(text).toContain('**Step 4:** Use `/help` for the full command guide');
    expect(text).not.toContain('🃏');
    expect(text).not.toContain('**Step 5:**');
    expect(text).not.toContain('✨');
    expect(text).not.toContain('🗂️');
    expect(text).not.toContain('Vaultr’s weekly set');
    expect(text).not.toContain('☕');
    expect(text).not.toContain('**Plan Details:**');
    expect(text).not.toContain('Free Vault or Full Vault access');
    expect(text).not.toContain('brewing');
    expect(text).not.toContain('discover what you love');
    expect(text).not.toContain('Build a sharper Vault');
    expect(text).not.toContain('grails, promos, and favorite finds');
    expect(text).not.toContain('**Saved Chases:**');
    expect(text).not.toContain('collector recaps');
    expect(text).not.toContain('server channel when they land');
    expect(text).not.toContain('**Plan:**');
    expect(text).not.toContain('**Active Chases:**');
    expect(text).not.toContain('**Paused Chases:**');
    expect(text).not.toContain('**Minimum Confidence:**');
    expect(text).not.toContain('**Price Currency:**');
    expect(text).not.toContain('PRO');
    expect(text).not.toContain('CAD');
    expect(text).not.toContain('92');
  });
});