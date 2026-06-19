import { formatPollInterval, PLAN_LIMITS } from '../services/plans.js';

export const FULL_VAULT_SUMMARY = 'More room for grails, faster checks, Trusted Shops, precision controls, and the full Weekly Shelf';
export const FULL_VAULT_CTA = '`/upgrade` opens the Full Vault';

export function fullVaultLines(): string[] {
  return [FULL_VAULT_SUMMARY, FULL_VAULT_CTA];
}

export function freeVaultLimitMessage(action = 'Remove one with `/chase remove` or run `/upgrade`'): string {
  return `Free Vaults can keep ${PLAN_LIMITS.FREE.maxActiveChases} active chases. Full Vault opens more room for the cards you love: ${PLAN_LIMITS.PRO.maxActiveChases} active chases, faster checks, Trusted Shops, precision controls, and the full Weekly Shelf. ${action}`;
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
    '- Trusted Shops alongside eBay, including shop-only restock signals',
    '- a deeper Weekly Shelf with taste profile memory',
    '- precision controls for condition, listing type, custom exclusions, priority, and chase notes',
    '- feedback-powered custom exclusions that keep your watchlist cleaner over time'
  ];
}
