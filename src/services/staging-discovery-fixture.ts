import { getUserById } from './accounts.js';
import { getUserAlertSettings, getUserDiscoveryFeedback, undoDiscoveryFeedback } from './chase-store.js';
import { assertStagingEnvironment } from './staging-config.js';
import {
  deleteScheduledDiscoveryDrop,
  getScheduledDiscoveryDrop,
  listScheduledDiscoveryDropsForUser,
  scheduledDiscoveryPeriodKey,
  upsertScheduledDiscoveryDrop,
  type ScheduledDiscoveryDropItem
} from './scheduled-discovery-drops.js';

export const STAGING_DISCOVERY_FIXTURE_MARKER = 'VAULTR_STAGING_PERSONALIZED_FIXTURE_V1';

const FIXTURE_CARDS = [
  {
    name: 'Mew CoroCoro Promo 151',
    setName: 'CoroCoro Comic Promo',
    cardNumber: '151',
    language: 'JAPANESE' as const,
    sourceCardId: 'staging-mew-corocoro-151',
    imageUrl: '/onboarding-art/mew-corocoro-promo-151.webp',
    lane: 'Collector Match',
    why: 'A distinctive Japanese promo selected to exercise personalized taste feedback.'
  },
  {
    name: 'Pichu Expedition Base Set 22/165',
    setName: 'Expedition Base Set',
    cardNumber: '22/165',
    language: 'ENGLISH' as const,
    sourceCardId: 'staging-pichu-expedition-22',
    imageUrl: '/onboarding-art/pichu-expedition-022.webp',
    lane: 'Collector Trail',
    why: 'An e-Reader printing selected to exercise adjacent recommendation feedback.'
  },
  {
    name: 'Sylveon ex 212/187',
    setName: 'Prismatic Evolutions',
    cardNumber: '212/187',
    language: 'ENGLISH' as const,
    sourceCardId: 'staging-sylveon-ex-212',
    imageUrl: '/onboarding-art/sylveon-ex-212.webp',
    lane: 'Something Different',
    why: 'A modern special-art printing selected to exercise varied recommendation feedback.'
  }
] as const;

function fixturePeriod(now: Date): string {
  return `${scheduledDiscoveryPeriodKey('WEEKLY_DISCOVERY', now)}-STAGING`;
}

function fixtureItems(currency: ReturnType<typeof getUserAlertSettings>['alertCurrency']): ScheduledDiscoveryDropItem[] {
  return FIXTURE_CARDS.map((card, index) => ({
    position: index + 1,
    suggestion: {
      name: card.name,
      why: card.why,
      lane: card.lane,
      laneWhy: 'Synthetic staging coverage for the real personalized feedback workflow.',
      nearby: [],
      canonicalReference: {
        provider: 'VAULTR_STAGING_FIXTURE',
        sourceCardId: card.sourceCardId,
        canonicalCardId: card.sourceCardId,
        canonicalName: card.name,
        setName: card.setName,
        cardNumber: card.cardNumber,
        language: card.language,
        imageUrl: card.imageUrl,
        imageSourceKind: 'CARD_REFERENCE'
      }
    },
    imageUrl: card.imageUrl,
    imageSourceName: 'VAULTR_STAGING_FIXTURE',
    imageSourceKind: 'CARD_REFERENCE',
    market: { status: 'MISSING', currency }
  }));
}

function assertFixtureEnvironment(env: NodeJS.ProcessEnv, cwd: string): void {
  assertStagingEnvironment(env, cwd);
  if (env.DISCOVERY_DROP_SCHEDULER_ENABLED !== 'false') {
    throw new Error('Staging Discovery scheduling must be disabled');
  }
}

export function installStagingDiscoveryFixture(input: {
  userId: string;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  now?: Date;
}) {
  const env = input.env ?? process.env;
  const cwd = input.cwd ?? process.cwd();
  assertFixtureEnvironment(env, cwd);
  const userId = input.userId.trim();
  if (!userId) throw new Error('An explicit --user account ID is required');
  if (!getUserById(userId)) throw new Error(`Staging account not found: ${userId}`);
  const now = input.now ?? new Date();
  const periodKey = fixturePeriod(now);
  const existingFixture = getScheduledDiscoveryDrop(userId, 'WEEKLY_DISCOVERY', periodKey);
  if (existingFixture) {
    if (existingFixture.summary !== STAGING_DISCOVERY_FIXTURE_MARKER) {
      throw new Error(`Refusing to overwrite unowned Display Case ${periodKey}`);
    }
    return { action: 'UNCHANGED' as const, drop: existingFixture };
  }
  const genuine = listScheduledDiscoveryDropsForUser(userId, 'WEEKLY_DISCOVERY')
    .find((drop) => drop.summary !== STAGING_DISCOVERY_FIXTURE_MARKER);
  if (genuine) throw new Error(`Refusing to shadow existing Display Case ${genuine.periodKey}`);
  const existingFeedback = FIXTURE_CARDS.find((card) => getUserDiscoveryFeedback(userId, card.name));
  if (existingFeedback) throw new Error(`Refusing to claim existing feedback for ${existingFeedback.name}`);

  const settings = getUserAlertSettings(userId);
  const availableAt = new Date(now.getTime() - 60_000).toISOString();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60_000).toISOString();
  const drop = upsertScheduledDiscoveryDrop({
    userId,
    dropType: 'WEEKLY_DISCOVERY',
    periodKey,
    status: 'PARTIAL',
    title: 'Synthetic personalized Display Case',
    summary: STAGING_DISCOVERY_FIXTURE_MARKER,
    currency: settings.alertCurrency,
    availableAt,
    expiresAt,
    sourceStateUpdatedAt: now.toISOString(),
    items: fixtureItems(settings.alertCurrency)
  }, now.toISOString());
  return { action: 'CREATED' as const, drop };
}

export function removeStagingDiscoveryFixture(input: {
  userId: string;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}) {
  const env = input.env ?? process.env;
  const cwd = input.cwd ?? process.cwd();
  assertFixtureEnvironment(env, cwd);
  const userId = input.userId.trim();
  if (!userId) throw new Error('An explicit --user account ID is required');
  const drops = listScheduledDiscoveryDropsForUser(userId, 'WEEKLY_DISCOVERY')
    .filter((drop) => drop.summary === STAGING_DISCOVERY_FIXTURE_MARKER);
  for (const drop of drops) {
    for (const item of drop.items) {
      const feedback = getUserDiscoveryFeedback(userId, item.suggestion.name);
      if (feedback) undoDiscoveryFeedback({ userId, cardName: item.suggestion.name, expectedVersion: feedback.version });
    }
    deleteScheduledDiscoveryDrop(userId, 'WEEKLY_DISCOVERY', drop.periodKey);
  }
  return drops.length
    ? { action: 'REMOVED' as const, count: drops.length }
    : { action: 'NOT_FOUND' as const, count: 0 };
}
