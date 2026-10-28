import { getUserById, setGeneralDiscoveryStartedAt } from './accounts.js';
import { getUserPlan, listChases, listCompletedChases, setUserPlan } from './chase-store.js';
import { assertStagingEnvironment } from './staging-config.js';
import { APPROVED_STARTER_DISCOVERY } from './starter-discovery.js';

export type StagingPlanTier = 'FREE' | 'PRO';

export type StagingStarterExclusion = {
  name: string;
  location: 'WATCHLIST' | 'PICKUPS';
};

export function setStagingAccountPlan(input: {
  userId: string;
  tier: StagingPlanTier;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  refreshStarter?: boolean;
  now?: Date;
}) {
  assertStagingEnvironment(input.env ?? process.env, input.cwd ?? process.cwd());
  const userId = input.userId.trim();
  if (!userId) throw new Error('An explicit --user account ID is required');
  if (input.tier !== 'FREE' && input.tier !== 'PRO') throw new Error('Plan must be FREE or PRO');
  if (!getUserById(userId)) throw new Error(`Staging account not found: ${userId}`);
  if (input.refreshStarter && input.tier !== 'FREE') throw new Error('--refresh-starter requires plan FREE');
  setUserPlan(userId, input.tier, 'ACTIVE');
  const exclusions: StagingStarterExclusion[] = [];
  if (input.refreshStarter) {
    setGeneralDiscoveryStartedAt(userId, input.now ?? new Date());
    const active = listChases(userId);
    const completed = listCompletedChases(userId);
    for (const starter of APPROVED_STARTER_DISCOVERY) {
      const matches = (item: { cardName: string; cardImageSourceName?: string; cardImageSourceCardId?: string }) =>
        (item.cardImageSourceName === 'VAULTR_EDITORIAL' && item.cardImageSourceCardId === starter.sourceCardId)
        || item.cardName.trim().toLowerCase() === starter.name.toLowerCase();
      if (active.some(matches)) exclusions.push({ name: starter.name, location: 'WATCHLIST' });
      if (completed.some(matches)) exclusions.push({ name: starter.name, location: 'PICKUPS' });
    }
  }
  const plan = getUserPlan(userId);
  if (!plan) throw new Error(`Unable to read staging plan for: ${userId}`);
  return { ...plan, starterRefreshed: !!input.refreshStarter, exclusions };
}
