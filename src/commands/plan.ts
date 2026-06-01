import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { getUserAlertSettings, getUserPlan, setUserAlertSettings } from '../services/chase-store.js';
import { activePlanTier, formatPollInterval, PLAN_LIMITS } from '../services/plans.js';
import { listTrustedShopifyShopNames } from '../services/shopify.js';
import { infoEmbed, warningEmbed } from '../ui/embeds.js';
import { formatLocalDateTime } from '../ui/time.js';
import { executePlanSet } from './plan-set.js';
import type { ListingSourceModePreference } from '../types.js';

const PLAN_SOURCE_PREFIX = 'plan-source';

function displaySourceMode(value: ListingSourceModePreference): string {
  if (value === 'EBAY_SHOPIFY') return 'eBay + Trusted Shops';
  if (value === 'SHOPIFY') return 'Trusted Shops Only';
  return 'eBay';
}

function planSourceButton(
  userId: string,
  mode: ListingSourceModePreference,
  label: string,
  style = ButtonStyle.Secondary,
  disabled = false
): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(`${PLAN_SOURCE_PREFIX}:${userId}:${mode}`)
    .setLabel(label)
    .setStyle(style)
    .setDisabled(disabled);
}

function planSourceRows(userId: string, activeTier: 'FREE' | 'PRO', currentSource: ListingSourceModePreference): ActionRowBuilder<ButtonBuilder>[] {
  if (activeTier !== 'PRO') return [];

  const buttons = [
    planSourceButton(
      userId,
      'EBAY_SHOPIFY',
      currentSource === 'EBAY_SHOPIFY' ? 'eBay + Trusted Shops Active' : 'Use eBay + Trusted Shops',
      ButtonStyle.Primary,
      currentSource === 'EBAY_SHOPIFY'
    ),
    planSourceButton(
      userId,
      'SHOPIFY',
      currentSource === 'SHOPIFY' ? 'Trusted Shops Only Active' : 'Trusted Shops Only',
      ButtonStyle.Secondary,
      currentSource === 'SHOPIFY'
    )
  ];

  return buttons.length > 0 ? [new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons)] : [];
}

function buildPlanViewPayload(userId: string, title = '🧾 Your Vaultr Plan') {
  const userPlan = getUserPlan(userId);
  const settings = getUserAlertSettings(userId);
  const activeTier = activePlanTier(userPlan);
  const limits = PLAN_LIMITS[activeTier];
  const trustedShopNames = listTrustedShopifyShopNames().join(', ');
  const activeAccessLine = userPlan.tier === activeTier ? activeTier : `${activeTier} (${userPlan.tier} ${userPlan.status}; Pro paused)`;
  const embed = infoEmbed(title, 'Your Vault access and Pro controls at a glance.');
  embed.addFields(
    {
      name: 'Access',
      value: [`**Tier:** ${userPlan.tier}`, `**Status:** ${userPlan.status}`, `**Active:** ${activeAccessLine}`].join('\n'),
      inline: false
    },
    {
      name: 'Capacity',
      value: [
        `**Chases:** ${limits.maxActiveChases} active`,
        `**Listing Checks:** Every ${formatPollInterval(limits.pollIntervalSeconds)}`
      ].join('\n'),
      inline: false
    },
    {
      name: 'Sources',
      value: [
        `**Current:** ${displaySourceMode(settings.listingSourceMode)}`,
        activeTier === 'PRO'
          ? '**Trusted Shops:** Choose eBay + shops, or shops only, with the buttons below'
          : '**Trusted Shops:** Unlock with Pro for shop restocks and fixed-price singles',
        `**Wired Shops:** ${trustedShopNames}`
      ].join('\n'),
      inline: false
    },
    {
      name: 'Discovery',
      value: activeTier === 'PRO' ? 'Full Taste Profile depth' : 'Basic taste paths; Pro deepens weekly Taste Profile recaps',
      inline: false
    },
    {
      name: 'Updated',
      value: formatLocalDateTime(userPlan.updatedAt),
      inline: false
    }
  );

  return {
    embeds: [embed],
    components: planSourceRows(userId, activeTier, settings.listingSourceMode),
    flags: MessageFlags.Ephemeral
  };
}

export const plan = {
  data: new SlashCommandBuilder()
    .setName('plan')
    .setDescription('View your Vaultr plan and Vault capacity')
    .addSubcommand((sub) => sub.setName('view').setDescription('Show your plan, limits, and Pro depth'))
    .addSubcommand((sub) =>
      sub
        .setName('set')
        .setDescription('Admin: set a user plan tier for testing')
        .addUserOption((opt) => opt.setName('user').setDescription('User to update').setRequired(true))
        .addStringOption((opt) =>
          opt
            .setName('tier')
            .setDescription('Plan tier to assign')
            .setRequired(true)
            .addChoices(
              { name: 'FREE', value: 'FREE' },
              { name: 'PRO', value: 'PRO' }
            )
        )
        .addStringOption((opt) =>
          opt
            .setName('status')
            .setDescription('Plan status to assign')
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

export async function handlePlanSourceButtons(interaction: any): Promise<boolean> {
  if (!interaction.isButton()) return false;
  if (!interaction.customId.startsWith(`${PLAN_SOURCE_PREFIX}:`)) return false;

  const [, ownerUserId, sourceRaw] = interaction.customId.split(':');
  if (interaction.user.id !== ownerUserId) {
    await interaction.reply({
      embeds: [warningEmbed('Not Your Plan', 'Only the original requester can update this Vault source.')],
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  const source = sourceRaw as ListingSourceModePreference;
  if (source !== 'EBAY' && source !== 'EBAY_SHOPIFY' && source !== 'SHOPIFY') return false;

  const userPlan = getUserPlan(interaction.user.id);
  if (activePlanTier(userPlan) !== 'PRO') {
    await interaction.reply({
      embeds: [warningEmbed('Pro Feature', 'Trusted shop source controls are available on Pro.')],
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  setUserAlertSettings(interaction.user.id, { listingSourceMode: source });
  const payload = buildPlanViewPayload(interaction.user.id, '✅ Plan Source Updated');
  await interaction.update({ embeds: payload.embeds, components: payload.components });
  return true;
}
