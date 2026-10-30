import { formatPollInterval, PLAN_LIMITS } from '../services/plans.js';

export const FULL_VAULT_SUMMARY = 'More room for cards, faster checks, supported shops, precision controls, and a personalized Display Case';
export const FULL_VAULT_CTA = '`/upgrade` explains KeepSeek Plus';

export function fullVaultLines(): string[] {
  return [FULL_VAULT_SUMMARY, FULL_VAULT_CTA];
}

export function freeVaultLimitMessage(action = 'Remove one with `/chase remove` or run `/upgrade`'): string {
  return `Free accounts can keep ${PLAN_LIMITS.FREE.maxActiveChases} active chases. KeepSeek Plus opens more room for the cards you love: ${PLAN_LIMITS.PRO.maxActiveChases} active chases, faster checks, supported shops, precision controls, and a personalized Display Case. ${action}`;
}

export function proControlsNextLine(): string {
  return `**Next:** ${FULL_VAULT_CTA}`;
}

export function upgradeFreeVaultLines(): string[] {
  return [
    `- ${PLAN_LIMITS.FREE.maxActiveChases} active chases`,
    `- eBay checks every ${formatPollInterval(PLAN_LIMITS.FREE.pollIntervalSeconds)}`,
    '- Weekly Discovery previews shaped by active chases'
  ];
}

export function upgradeFullVaultLines(): string[] {
  return [
    `- ${PLAN_LIMITS.PRO.maxActiveChases} active chases with faster checks every ${formatPollInterval(PLAN_LIMITS.PRO.pollIntervalSeconds)}`,
    '- supported shops alongside eBay, including shop-only restock signals',
    '- a personalized Display Case shaped by your collection and feedback',
    '- precision controls for condition, listing type, custom exclusions, priority, and chase notes',
    '- feedback-powered custom exclusions that keep your watchlist cleaner over time'
  ];
}
