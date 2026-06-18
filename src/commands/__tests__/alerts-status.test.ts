import { describe, expect, it } from 'vitest';
import { buildAlertsStatusEmbed } from '../alerts-status.js';
import { addChase, markAlertSentWithDetails, markChasesPollChecked, removeAllChases, resetUserAlertSettings, setUserAlertSettings, setUserPlan } from '../../services/chase-store.js';

function embedFieldValue(embed: ReturnType<typeof buildAlertsStatusEmbed>, name: string): string {
  const json = embed.toJSON();
  const field = json.fields?.find((candidate) => candidate.name === name);
  return field?.value ?? '';
}

describe('buildAlertsStatusEmbed', () => {
  it('summarizes active watching without source calls', () => {
    const userId = 'status-user-active';
    removeAllChases(userId);
    resetUserAlertSettings(userId);
    setUserPlan(userId, 'PRO');
    setUserAlertSettings(userId, { alertCurrency: 'CAD', shippingCountry: 'CA', shippingPostalCode: 'M5V', listingSourceMode: 'EBAY_SHOPIFY' });
    const chase = addChase({ userId, cardName: 'Squirtle 007/018', priority: 'GRAIL', maxPrice: 1200 });
    markChasesPollChecked([chase.id], '2026-06-12T18:55:00.000Z');
    markAlertSentWithDetails(chase.id, userId, 'v1|123|0', 'EBAY', {
      listingTitle: 'Squirtle 007/018',
      listingPrice: 100,
      listingCurrency: 'CAD',
      matchScore: 97
    });

    const embed = buildAlertsStatusEmbed(userId, new Date('2026-06-12T19:00:00.000Z'));

    expect(embed.toJSON().title).toBe('🟢 Vaultr Watch Status');
    expect(embed.toJSON().description).toBe('Fresh matches surfaced today');
    expect(embed.toJSON().description).not.toContain(';');
    expect(embedFieldValue(embed, 'Watching')).toContain('**Active:** 1/50');
    expect(embedFieldValue(embed, 'Sweeps')).toContain('**Next:** about 10m');
    expect(embedFieldValue(embed, 'Finds')).toContain('**Last 24h:** 1');
    expect(embed.toJSON().fields?.some((field) => field.name === 'Rules')).toBe(false);
    expect(JSON.stringify(embed.toJSON().fields)).not.toContain('eBay + trusted shops');
    expect(JSON.stringify(embed.toJSON().fields)).not.toContain('CAD');
  });

  it('frames paused chases calmly for Free users', () => {
    const userId = 'status-user-free';
    removeAllChases(userId);
    resetUserAlertSettings(userId);
    setUserPlan(userId, 'FREE');
    for (let index = 0; index < 4; index += 1) {
      addChase({ userId, cardName: `Pikachu ${index}`, priority: 'NORMAL' });
    }

    const embed = buildAlertsStatusEmbed(userId, new Date('2026-06-12T19:00:00.000Z'));

    expect(embed.toJSON().description).toBe('Extra saved chases are paused by plan limit');
    expect(embed.toJSON().description).not.toContain(';');
    expect(embedFieldValue(embed, 'Watching')).toContain('**Active:** 3/3');
    expect(embedFieldValue(embed, 'Watching')).toContain('**Paused:** 1');
    expect(embed.toJSON().fields?.some((field) => field.name === 'Quiet Read')).toBe(false);
    expect(embed.toJSON().fields?.some((field) => field.name === 'Rules')).toBe(false);
  });
});
