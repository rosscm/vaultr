import { describe, expect, it } from 'vitest';
import { buildPlanViewPayload } from '../plan.js';
import { resetUserAlertSettings, setUserPlan } from '../../services/chase-store.js';
import { formatActivePlanAccess } from '../../services/plans.js';

describe('formatActivePlanAccess', () => {
  it('shows active Pro access for active Pro users', () => {
    expect(formatActivePlanAccess({ tier: 'PRO', status: 'ACTIVE' })).toBe('PRO');
  });

  it('shows Free access when Pro is past due or canceled', () => {
    expect(formatActivePlanAccess({ tier: 'PRO', status: 'PAST_DUE' })).toBe('FREE (PRO PAST_DUE; Pro paused)');
    expect(formatActivePlanAccess({ tier: 'PRO', status: 'CANCELED' })).toBe('FREE (PRO CANCELED; Pro paused)');
  });
});

describe('buildPlanViewPayload', () => {
  it('frames Free access as a compact account snapshot instead of alert settings', () => {
    const userId = `plan-free-${Date.now()}`;
    resetUserAlertSettings(userId);
    setUserPlan(userId, 'FREE');

    const payload = buildPlanViewPayload(userId);
    const data = payload.embeds[0].toJSON();
    const text = [data.description, ...(data.fields ?? []).map((field) => `${field.name}\n${field.value}`)].join('\n');

    expect(text).toContain('Free Vault is live');
    expect(text).toContain('Current Vault\n**Vault:** Free Vault');
    expect(text).toContain('**Access:** Free');
    expect(text).toContain('core chase tracking and Weekly Discovery previews');
    expect(data.fields?.some((field) => field.name === 'Updated' && !field.value.includes('Updated:'))).toBe(true);
    expect(text).toContain('Full Vault\nMore room for grails, faster checks, trusted shops, precision controls, and the full Weekly Shelf');
    expect(text).toContain('`/upgrade` opens the Full Vault');
    expect(text).not.toContain('**Active Chases:**');
    expect(text).not.toContain('**Watch Cadence:**');
    expect(text).not.toContain('**Watching:**');
    expect(text).not.toContain('Sources\n');
    expect(text).not.toContain('**Pro Adds:**');
    expect(text).not.toContain('Pro Unlocks');
    expect(text).not.toContain('Free access is active');
  });

  it('shows active Full Vault access without duplicating alert configuration', () => {
    const userId = `plan-pro-${Date.now()}`;
    resetUserAlertSettings(userId);
    setUserPlan(userId, 'PRO');

    const payload = buildPlanViewPayload(userId);
    const data = payload.embeds[0].toJSON();
    const text = [data.description, ...(data.fields ?? []).map((field) => `${field.name}\n${field.value}`)].join('\n');

    expect(text).toContain('Full Vault is active');
    expect(text).toContain('Current Vault\n**Vault:** Full Vault');
    expect(text).toContain('**Access:** Pro');
    expect(text).toContain('trusted shops, and precision controls');
    expect(data.fields?.some((field) => field.name === 'Updated' && !field.value.includes('Updated:'))).toBe(true);
    expect(text).not.toContain('**Watch Cadence:**');
    expect(text).not.toContain('**Watching:**');
    expect(text).not.toContain('Source Controls');
  });
});