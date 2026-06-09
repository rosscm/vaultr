import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { getUserAlertSettings, getUserPlan } from '../services/chase-store.js';
import { getEntitlementsForTier } from '../services/entitlements.js';
import { activePlanTier, formatActivePlanAccess, formatPollInterval, PLAN_LIMITS } from '../services/plans.js';
import { listTrustedShopifyShopNames } from '../services/shopify.js';
import { infoEmbed, warningEmbed } from '../ui/embeds.js';
import { formatLocalDateTime } from '../ui/time.js';
import { executePlanSet } from './plan-set.js';
import type { ListingSourceModePreference } from '../types.js';

function displaySourceMode(value: ListingSourceModePreference): string {
  if (value === 'EBAY_SHOPIFY') return 'eBay + Trusted Shops';
  if (value === 'SHOPIFY') return 'Trusted Shops Only';
  return 'eBay';
}

export function displayEffectiveSourceMode(value: ListingSourceModePreference, activeTier: 'FREE' | 'PRO'): string {
  const entitlements = getEntitlementsForTier(activeTier);
  if (entitlements.storefrontMonitoring) return displaySourceMode(value);
  if (value === 'EBAY_SHOPIFY' || value === 'SHOPIFY') return displaySourceMode('EBAY');
  return displaySourceMode(value);
}

function buildPlanViewPayload(userId: string, title = '🧾 Vaultr Plan') {
  const userPlan = getUserPlan(userId);
  const settings = getUserAlertSettings(userId);
  const activeTier = activePlanTier(userPlan);
  const limits = PLAN_LIMITS[activeTier];
  const trustedShopNames = listTrustedShopifyShopNames().join(', ');
  const activeAccessLine = formatActivePlanAccess(userPlan);
  const sourceLine = `**Source:** ${displayEffectiveSourceMode(settings.listingSourceMode, activeTier)}`;
  const shopLine = activeTier === 'PRO' ? `**Shops:** ${trustedShopNames}` : `**Pro Unlocks:** shop sources, faster checks, and deeper Discovery`;
  const nextLine = activeTier === 'PRO' ? '**Source Controls:** use `/alerts settings` to pick a watch mode' : '**Next:** use `/upgrade` to unlock Pro';
  const embed = infoEmbed(title, activeTier === 'PRO' ? 'Pro access is active.' : 'Free access is active. Upgrade anytime for more chases and source controls.');
  embed.addFields(
    {
      name: 'Plan',
      value: [`**Access:** ${activeAccessLine}`, `**Chases:** ${limits.maxActiveChases} active`, `**Checks:** Every ${formatPollInterval(limits.pollIntervalSeconds)}`].join('\n'),
      inline: false
    },
    {
      name: 'Vault Depth',
      value: activeTier === 'PRO' ? 'Full Discovery recommendations and Taste Profile memory' : 'Discovery preview from active chases',
      inline: false
    },
    {
      name: 'Sources',
      value: [sourceLine, shopLine, nextLine, `**Updated:** ${formatLocalDateTime(userPlan.updatedAt)}`].join('\n'),
      inline: false
    }
  );

  return {
    embeds: [embed],
    components: [],
    flags: MessageFlags.Ephemeral
  };
}

export const plan = {
  data: new SlashCommandBuilder()
    .setName('plan')
    .setDescription('View your Vaultr plan')
    .addSubcommand((sub) => sub.setName('view').setDescription('Show your plan, limits, and Pro access'))
    .addSubcommand((sub) =>
      sub
        .setName('set')
        .setDescription('Admin: update a user plan')
        .addUserOption((opt) => opt.setName('user').setDescription('Member to update').setRequired(true))
        .addStringOption((opt) =>
          opt
            .setName('tier')
            .setDescription('Plan tier')
            .setRequired(true)
            .addChoices(
              { name: 'FREE', value: 'FREE' },
              { name: 'PRO', value: 'PRO' }
            )
        )
        .addStringOption((opt) =>
          opt
            .setName('status')
            .setDescription('Plan status')
            .addChoices(
              { name: 'ACTIVE', value: 'ACTIVE' },
              { name: 'PAST_DUE', value: 'PAST_DUE' },
              { name: 'CANCELED', value: 'CANCELED' }
            )
        )
    ),
  async execute(interaction: any) {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === 'set') {
      if (!interaction.guildId || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        await interaction.reply({
          embeds: [warningEmbed('Admin Only', 'This subcommand requires Manage Server permissions in a server')],
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      await executePlanSet(interaction);
      return;
    }

    await interaction.reply(buildPlanViewPayload(interaction.user.id));
  }
};
