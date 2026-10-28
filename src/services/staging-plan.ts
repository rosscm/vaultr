import { getUserById } from './accounts.js';
import { getUserPlan, setUserPlan } from './chase-store.js';
import { assertStagingEnvironment } from './staging-config.js';

export type StagingPlanTier = 'FREE' | 'PRO';

export function setStagingAccountPlan(input: {
  userId: string;
  tier: StagingPlanTier;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}) {
  assertStagingEnvironment(input.env ?? process.env, input.cwd ?? process.cwd());
  const userId = input.userId.trim();
  if (!userId) throw new Error('An explicit --user account ID is required');
  if (input.tier !== 'FREE' && input.tier !== 'PRO') throw new Error('Plan must be FREE or PRO');
  if (!getUserById(userId)) throw new Error(`Staging account not found: ${userId}`);
  setUserPlan(userId, input.tier, 'ACTIVE');
  return getUserPlan(userId);
}
