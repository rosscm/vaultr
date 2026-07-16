import { afterEach, describe, expect, it } from 'vitest';
import {
  countAnnounceableScheduledDiscoveryDrops,
  countPreparedScheduledDiscoveryDrops,
  deleteScheduledDiscoveryDropAnnouncement,
  deleteScheduledDiscoveryDrop,
  getLatestAvailableScheduledDiscoveryDrop,
  getScheduledDiscoveryDrop,
  hasScheduledDiscoveryDropAnnouncement,
  markScheduledDiscoveryDropAnnouncement,
  scheduledDiscoveryAvailability,
  scheduledDiscoveryPeriodKey,
  upsertScheduledDiscoveryDrop
} from '../scheduled-discovery-drops.js';

const drops: Array<{ userId: string; periodKey: string }> = [];
const announcements: Array<{ guildId: string; periodKey: string }> = [];

afterEach(() => {
  for (const drop of drops.splice(0)) deleteScheduledDiscoveryDrop(drop.userId, 'WEEKLY_DISCOVERY', drop.periodKey);
  for (const announcement of announcements.splice(0)) {
    deleteScheduledDiscoveryDropAnnouncement(announcement.guildId, 'WEEKLY_DISCOVERY', announcement.periodKey);
  }
});

function track(userId: string, periodKey: string): void {
  drops.push({ userId, periodKey });
}

function trackAnnouncement(guildId: string, periodKey: string): void {
  announcements.push({ guildId, periodKey });
}

describe('scheduled discovery drops', () => {
  it('builds stable weekly period windows', () => {
    const date = new Date('2026-06-10T16:00:00.000Z');

    expect(scheduledDiscoveryPeriodKey('WEEKLY_DISCOVERY', date)).toBe('2026-W24');
    expect(scheduledDiscoveryPeriodKey('MARKET_RADAR', date)).toBe('2026-W24-FRI');
    expect(scheduledDiscoveryAvailability('WEEKLY_DISCOVERY', date)).toEqual({
      availableAt: '2026-06-08T12:00:00.000Z',
      expiresAt: '2026-06-15T12:00:00.000Z'
    });
    expect(scheduledDiscoveryAvailability('MARKET_RADAR', date)).toEqual({
      availableAt: '2026-06-12T00:00:00.000Z',
      expiresAt: '2026-06-15T00:00:00.000Z'
    });
  });

  it('keeps weekly discovery drops at Monday 8 AM Eastern across DST changes', () => {
    expect(scheduledDiscoveryAvailability('WEEKLY_DISCOVERY', new Date('2026-01-07T16:00:00.000Z')).availableAt).toBe('2026-01-05T13:00:00.000Z');
    expect(scheduledDiscoveryAvailability('WEEKLY_DISCOVERY', new Date('2026-06-10T16:00:00.000Z')).availableAt).toBe('2026-06-08T12:00:00.000Z');
  });

  it('stores and reads a prepared weekly drop with normalized items', () => {
    const userId = `drop-user-${Date.now()}`;
    const periodKey = scheduledDiscoveryPeriodKey('WEEKLY_DISCOVERY', new Date('2026-06-10T16:00:00.000Z'));
    track(userId, periodKey);

    const saved = upsertScheduledDiscoveryDrop(
      {
        userId,
        dropType: 'WEEKLY_DISCOVERY',
        periodKey,
        status: 'READY',
        title: 'Weekly Discovery',
        summary: 'Prepared collector paths for the week.',
        currency: 'CAD',
        availableAt: '2026-06-08T00:00:00.000Z',
        expiresAt: '2026-06-15T00:00:00.000Z',
        sourceStateUpdatedAt: '2026-06-10T15:00:00.000Z',
        items: [
          {
            position: 1,
            suggestion: {
              name: 'Mew ex Paldean Fates 232',
              lane: 'Collector Compass',
              laneWhy: 'Mew taste signal',
              why: 'Mew taste signal',
              nearby: [],
              evidenceSearchTerm: 'Mew ex Paldean Fates 232 Pokemon card'
            },
            imageUrl: 'https://images.example/mew.png',
            imageSourceName: 'Pokemon TCG API',
            imageSourceKind: 'CARD_REFERENCE',
            market: {
              status: 'READY',
              currency: 'CAD',
              askingTotal: 1330,
              askingSampleSize: 5,
              listing: {
                id: 'listing-1',
                title: 'Mew ex 232/091 Paldean Fates',
                url: 'https://example.com/listing-1'
              },
              updatedAt: '2026-06-10T15:30:00.000Z'
            }
          }
        ]
      },
      '2026-06-10T16:00:00.000Z'
    );

    expect(saved.marketReadyCount).toBe(1);
    expect(saved.imageReadyCount).toBe(1);
    expect(saved.itemCount).toBe(1);
    expect(saved.items[0]).toMatchObject({
      position: 1,
      suggestion: { name: 'Mew ex Paldean Fates 232' },
      imageUrl: 'https://images.example/mew.png',
      imageSourceKind: 'CARD_REFERENCE',
      market: { status: 'READY', currency: 'CAD', askingTotal: 1330, askingSampleSize: 5 }
    });

    const latest = getLatestAvailableScheduledDiscoveryDrop(userId, 'WEEKLY_DISCOVERY', '2026-06-10T16:01:00.000Z');
    expect(latest?.periodKey).toBe(periodKey);
    expect(latest?.items[0].market.listing?.id).toBe('listing-1');
  });

  it('keeps legacy or unknown image provenance untrusted on scheduled drop reads', () => {
    const userId = `legacy-image-user-${Date.now()}`;
    const periodKey = scheduledDiscoveryPeriodKey('WEEKLY_DISCOVERY', new Date('2026-06-10T16:00:00.000Z'));
    track(userId, periodKey);

    const legacy = upsertScheduledDiscoveryDrop(
      {
        userId,
        dropType: 'WEEKLY_DISCOVERY',
        periodKey,
        status: 'READY',
        title: 'Weekly Discovery',
        currency: 'CAD',
        availableAt: '2026-06-08T00:00:00.000Z',
        expiresAt: '2026-06-15T00:00:00.000Z',
        items: [
          {
            position: 1,
            suggestion: {
              name: 'Legacy Card',
              lane: 'Collector Compass',
              laneWhy: 'legacy row',
              why: 'legacy row',
              nearby: []
            },
            imageUrl: 'https://images.example/legacy.png',
            imageSourceName: 'Pokemon TCG API',
            market: { status: 'READY', currency: 'CAD' }
          }
        ]
      },
      '2026-06-10T16:00:00.000Z'
    );

    expect(legacy.imageReadyCount).toBe(0);
    expect(legacy.items[0]?.imageSourceKind).toBeUndefined();

    const unknown = upsertScheduledDiscoveryDrop(
      {
        userId,
        dropType: 'WEEKLY_DISCOVERY',
        periodKey,
        status: 'READY',
        title: 'Weekly Discovery',
        currency: 'CAD',
        availableAt: '2026-06-08T00:00:00.000Z',
        expiresAt: '2026-06-15T00:00:00.000Z',
        items: [
          {
            position: 1,
            suggestion: {
              name: 'Unknown Provider Card',
              lane: 'Collector Compass',
              laneWhy: 'unknown provider',
              why: 'unknown provider',
              nearby: []
            },
            imageUrl: 'https://images.example/unknown.png',
            imageSourceName: 'Some Card Site',
            market: { status: 'READY', currency: 'CAD' }
          }
        ]
      },
      '2026-06-10T16:00:01.000Z'
    );

    expect(unknown.imageReadyCount).toBe(0);
    expect(unknown.items[0]?.imageSourceKind).toBeUndefined();
  });

  it('counts only CARD_REFERENCE images as image-ready', () => {
    const userId = `image-kind-count-user-${Date.now()}`;
    const periodKey = scheduledDiscoveryPeriodKey('WEEKLY_DISCOVERY', new Date('2026-06-10T16:00:00.000Z'));
    track(userId, periodKey);

    const saved = upsertScheduledDiscoveryDrop(
      {
        userId,
        dropType: 'WEEKLY_DISCOVERY',
        periodKey,
        status: 'READY',
        title: 'Weekly Discovery',
        currency: 'CAD',
        availableAt: '2026-06-08T00:00:00.000Z',
        expiresAt: '2026-06-15T00:00:00.000Z',
        items: [
          {
            position: 1,
            suggestion: { name: 'Reference Card', lane: 'Collector Compass', laneWhy: 'reference', why: 'reference', nearby: [] },
            imageUrl: 'https://images.example/reference.png',
            imageSourceName: 'Pokemon TCG API',
            imageSourceKind: 'CARD_REFERENCE',
            market: { status: 'READY', currency: 'CAD' }
          },
          {
            position: 2,
            suggestion: { name: 'Marketplace Card', lane: 'Collector Compass', laneWhy: 'listing', why: 'listing', nearby: [] },
            imageUrl: 'https://images.example/market.png',
            imageSourceName: 'eBay listing image',
            imageSourceKind: 'MARKET_LISTING',
            market: { status: 'READY', currency: 'CAD' }
          },
          {
            position: 3,
            suggestion: { name: 'Unknown Card', lane: 'Collector Compass', laneWhy: 'unknown', why: 'unknown', nearby: [] },
            imageUrl: 'https://images.example/unknown.png',
            imageSourceName: 'Some Card Site',
            market: { status: 'READY', currency: 'CAD' }
          }
        ]
      },
      '2026-06-10T16:00:00.000Z'
    );

    expect(saved.imageReadyCount).toBe(1);
    expect(saved.items[0]?.imageSourceKind).toBe('CARD_REFERENCE');
    expect(saved.items[1]?.imageSourceKind).toBe('MARKET_LISTING');
    expect(saved.items[2]?.imageSourceKind).toBeUndefined();
  });

  it('does not return a drop before its available window', () => {
    const userId = `future-drop-user-${Date.now()}`;
    const periodKey = '2026-W25';
    track(userId, periodKey);

    upsertScheduledDiscoveryDrop(
      {
        userId,
        dropType: 'WEEKLY_DISCOVERY',
        periodKey,
        status: 'PARTIAL',
        title: 'Weekly Discovery',
        currency: 'CAD',
        availableAt: '2026-06-15T00:00:00.000Z',
        expiresAt: '2026-06-22T00:00:00.000Z',
        items: []
      },
      '2026-06-10T16:00:00.000Z'
    );

    expect(getScheduledDiscoveryDrop(userId, 'WEEKLY_DISCOVERY', periodKey)?.status).toBe('PARTIAL');
    expect(getLatestAvailableScheduledDiscoveryDrop(userId, 'WEEKLY_DISCOVERY', '2026-06-14T23:59:00.000Z')).toBeNull();
  });

  it('counts prepared drops and records each guild announcement once', () => {
    const userId = `announcement-drop-user-${Date.now()}`;
    const guildId = `announcement-guild-${Date.now()}`;
    const periodKey = `2099-W${String(Date.now()).slice(-2)}`;
    track(userId, periodKey);
    trackAnnouncement(guildId, periodKey);

    expect(countPreparedScheduledDiscoveryDrops('WEEKLY_DISCOVERY', periodKey)).toBe(0);
    upsertScheduledDiscoveryDrop(
      {
        userId,
        dropType: 'WEEKLY_DISCOVERY',
        periodKey,
        status: 'READY',
        title: 'Weekly Discovery',
        currency: 'CAD',
        availableAt: '2026-06-08T00:00:00.000Z',
        expiresAt: '2026-06-15T00:00:00.000Z',
        items: [
          {
            position: 1,
            suggestion: {
              name: 'Charizard VSTAR SWSH262',
              lane: 'Collector Compass',
              laneWhy: 'promo taste signal',
              why: 'promo taste signal',
              nearby: []
            },
            market: { status: 'READY', currency: 'CAD', askingTotal: 45, askingSampleSize: 3 }
          }
        ]
      },
      '2026-06-10T16:00:00.000Z'
    );

    expect(countPreparedScheduledDiscoveryDrops('WEEKLY_DISCOVERY', periodKey)).toBe(1);
    expect(countAnnounceableScheduledDiscoveryDrops('WEEKLY_DISCOVERY', periodKey, 1)).toBe(1);
    expect(countAnnounceableScheduledDiscoveryDrops('WEEKLY_DISCOVERY', periodKey, 2)).toBe(0);
    expect(hasScheduledDiscoveryDropAnnouncement(guildId, 'WEEKLY_DISCOVERY', periodKey)).toBe(false);
    expect(
      markScheduledDiscoveryDropAnnouncement({
        guildId,
        dropType: 'WEEKLY_DISCOVERY',
        periodKey,
        channelId: 'channel-1',
        messageId: 'message-1',
        postedAt: '2026-06-10T16:05:00.000Z'
      })
    ).toBe(true);
    expect(hasScheduledDiscoveryDropAnnouncement(guildId, 'WEEKLY_DISCOVERY', periodKey)).toBe(true);
    expect(
      markScheduledDiscoveryDropAnnouncement({
        guildId,
        dropType: 'WEEKLY_DISCOVERY',
        periodKey,
        channelId: 'channel-1',
        messageId: 'message-2',
        postedAt: '2026-06-10T16:06:00.000Z'
      })
    ).toBe(false);
  });
});
