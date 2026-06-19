import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildPlanViewPayload, plan } from '../plan.js';
import { getUserPlan, resetUserAlertSettings, setUserPlan } from '../../services/chase-store.js';
import { formatActivePlanAccess, formatPollInterval, PLAN_LIMITS } from '../../services/plans.js';

const originalOwnerUserId = process.env.OWNER_USER_ID;

afterEach(() => {
  process.env.OWNER_USER_ID = originalOwnerUserId;
});

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
    const freeChaseLimit = PLAN_LIMITS.FREE.maxActiveChases;
    const proChaseLimit = PLAN_LIMITS.PRO.maxActiveChases;
    const freePollInterval = formatPollInterval(PLAN_LIMITS.FREE.pollIntervalSeconds);
    const proPollInterval = formatPollInterval(PLAN_LIMITS.PRO.pollIntervalSeconds);
    const userId = `plan-free-${Date.now()}`;
    resetUserAlertSettings(userId);
    setUserPlan(userId, 'FREE');

    const payload = buildPlanViewPayload(userId);
    const data = payload.embeds[0].toJSON();
    const text = [data.description, ...(data.fields ?? []).map((field) => `${field.name}\n${field.value}`)].join('\n');

    expect(text).toContain('Free Vault is active');
    expect(text).toContain('Current Access\n**Plan:** Free Vault');
    expect(text).not.toContain('**Access:** Free');
    expect(text).not.toContain('**Vault:** Free Vault');
    expect(text).toContain(`Free Vault is active: ${freeChaseLimit} active chases, DM alerts, and a starter Weekly Shelf preview`);
    expect(text).toContain(`Included\n- ${freeChaseLimit} active chases with eBay checks every ${freePollInterval}`);
    expect(text).toContain('- DM alerts with core tuning controls');
    expect(text).toContain('- starter Weekly Shelf preview based on active chases');
    expect(data.fields?.at(-1)?.name).toBe('Updated');
    expect(data.fields?.some((field) => field.name === 'Updated' && !field.value.includes('Updated:'))).toBe(true);
    expect(text).toContain(`Pro Features\n- ${proChaseLimit} active chases with checks every ${proPollInterval}`);
    expect(text).toContain('- trusted shops alongside eBay for shop-only restock signals');
    expect(text).toContain('- precision controls for conditions, listing types, custom exclusions, priority, and notes');
    expect(text).toContain('- a deeper Weekly Shelf that learns from taste profile memory');
    expect(text).toContain('- use `/upgrade` to open your Full Vault');
    expect(text).not.toContain('Weekly Shelf preview shaped by your Vault');
    expect(text).not.toContain('**Active Chases:**');
    expect(text).not.toContain('**Watch Cadence:**');
    expect(text).not.toContain('**Watching:**');
    expect(text).not.toContain('Sources\n');
    expect(text).not.toContain('**Pro Adds:**');
    expect(text).not.toContain('Free access is active');
  });

  it('shows active Full Vault access without duplicating alert configuration', () => {
    const proChaseLimit = PLAN_LIMITS.PRO.maxActiveChases;
    const proPollInterval = formatPollInterval(PLAN_LIMITS.PRO.pollIntervalSeconds);
    const userId = `plan-pro-${Date.now()}`;
    resetUserAlertSettings(userId);
    setUserPlan(userId, 'PRO');

    const payload = buildPlanViewPayload(userId);
    const data = payload.embeds[0].toJSON();
    const text = [data.description, ...(data.fields ?? []).map((field) => `${field.name}\n${field.value}`)].join('\n');

    expect(text).toContain('Full Vault is active');
    expect(text).toContain('Current Access\n**Plan:** Full Vault');
    expect(text).not.toContain('**Access:** Pro');
    expect(text).not.toContain('**Vault:** Full Vault');
    expect(text).toContain(`Full Vault is active: ${proChaseLimit} active chases, faster checks, trusted shops, precision controls, and a richer Weekly Shelf that learns from taste profile memory`);
    expect(text).toContain(`Included\n- ${proChaseLimit} active chases with checks every ${proPollInterval}`);
    expect(text).toContain('- trusted shops alongside eBay for shop-only restock signals');
    expect(text).toContain('- precision controls for conditions, listing types, custom exclusions, priority, and notes');
    expect(text).toContain('- richer Weekly Shelf recommendations powered by taste profile memory');
    expect(text).not.toContain('Trusted Shops, and precision controls');
    expect(data.fields?.at(-1)?.name).toBe('Updated');
    expect(data.fields?.some((field) => field.name === 'Updated' && !field.value.includes('Updated:'))).toBe(true);
    expect(text).not.toContain('**Watch Cadence:**');
    expect(text).not.toContain('**Watching:**');
    expect(text).not.toContain('Source Controls');
  });
});

describe('plan command', () => {
  function mockPlanSetInteraction(requesterId: string, targetId: string, tier = 'PRO') {
    const reply = vi.fn(async (_payload: any) => undefined);
    return {
      user: { id: requesterId },
      options: {
        getSubcommand: () => 'set',
        getUser: () => ({ id: targetId }),
        getString: (name: string) => {
          if (name === 'tier') return tier;
          if (name === 'status') return 'ACTIVE';
          return null;
        }
      },
      reply
    };
  }

  it('keeps plan set reserved for the Vaultr owner', async () => {
    process.env.OWNER_USER_ID = 'owner-user';
    const targetId = `plan-set-target-${Date.now()}`;
    setUserPlan(targetId, 'FREE');
    const interaction = mockPlanSetInteraction('server-admin', targetId);

    await plan.execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      embeds: expect.arrayContaining([expect.objectContaining({ data: expect.objectContaining({ title: expect.stringContaining('Owner Only') }) })])
    }));
    expect(getUserPlan(targetId).tier).toBe('FREE');
  });

  it('allows the Vaultr owner to update member access', async () => {
    process.env.OWNER_USER_ID = 'owner-user';
    const targetId = `plan-set-owner-target-${Date.now()}`;
    setUserPlan(targetId, 'FREE');
    const interaction = mockPlanSetInteraction('owner-user', targetId);

    await plan.execute(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      embeds: expect.arrayContaining([expect.objectContaining({ data: expect.objectContaining({ title: expect.stringContaining('Plan Updated') }) })])
    }));
    expect(getUserPlan(targetId).tier).toBe('PRO');
  });
});