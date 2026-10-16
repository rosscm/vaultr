import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { getUserAlertSettings, getUserPlan } from '../services/chase-store.js';
import {
  displayAlertVolume,
  isStorefrontSourceMode,
  updateAlertSettings,
  type AlertVolume
} from '../services/alert-settings.js';
import { activePlanTier, formatActivePlanAccess, PLAN_LIMITS } from '../services/plans.js';
import { infoEmbed, successEmbed, warningEmbed } from '../ui/embeds.js';
import { formatLocalDateTime } from '../ui/time.js';
import { OUTPUT_STYLE } from '../ui/style.js';
import { FULL_VAULT_SUMMARY, proControlsNextLine } from './pro-copy.js';
import type { ListingSourceModePreference } from '../types.js';

const ALERTS_SOURCE_PREFIX = 'alerts-source';

function displaySourceMode(value: ListingSourceModePreference): string {
  if (value === 'EBAY') return 'eBay';
  if (value === 'EBAY_SHOPIFY') return 'eBay + Trusted Shops';
  if (value === 'SHOPIFY') return 'Trusted Shops Only';
  return 'eBay';
}

function displayListingSourceSetting(value: ListingSourceModePreference, activeTier: 'FREE' | 'PRO'): string {
  if (activeTier === 'FREE' && isStorefrontSourceMode(value)) return 'eBay (stored shop preference paused)';
  return displaySourceMode(value);
}

function displayTrustedShopAccess(value: ListingSourceModePreference, activeTier: 'FREE' | 'PRO'): string {
  if (activeTier === 'FREE') {
    return isStorefrontSourceMode(value)
        ? `Paused until Pro (${PLAN_LIMITS.PRO.maxActiveChases} active chases + trusted shops)`
        : `Pro opens the Full Vault with ${PLAN_LIMITS.PRO.maxActiveChases} active chases + trusted shops`;
  }
  if (value === 'EBAY_SHOPIFY') return 'Enabled with eBay';
  if (value === 'SHOPIFY') return 'Enabled, trusted shops only';
  return 'Available. Choose eBay + Trusted Shops or Trusted Shops Only';
}

function sourceButton(
  userId: string,
  mode: ListingSourceModePreference,
  label: string,
  style = ButtonStyle.Secondary,
  disabled = false
): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(`${ALERTS_SOURCE_PREFIX}:${userId}:${mode}`)
    .setLabel(label)
    .setStyle(style)
    .setDisabled(disabled);
}

function sourceRows(userId: string, activeTier: 'FREE' | 'PRO', currentSource: ListingSourceModePreference): ActionRowBuilder<ButtonBuilder>[] {
  if (activeTier !== 'PRO') return [];

  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      sourceButton(userId, 'EBAY', currentSource === 'EBAY' ? 'eBay Only Active' : 'Use eBay Only', ButtonStyle.Secondary, currentSource === 'EBAY'),
      sourceButton(
        userId,
        'EBAY_SHOPIFY',
        currentSource === 'EBAY_SHOPIFY' ? 'eBay + Trusted Shops Active' : 'Use eBay + Trusted Shops',
        ButtonStyle.Primary,
        currentSource === 'EBAY_SHOPIFY'
      ),
      sourceButton(userId, 'SHOPIFY', currentSource === 'SHOPIFY' ? 'Trusted Shops Active' : 'Use Trusted Shops Only', ButtonStyle.Secondary, currentSource === 'SHOPIFY')
    )
  ];
}

function settingsFields(plan: ReturnType<typeof getUserPlan>, settings: ReturnType<typeof getUserAlertSettings>) {
  const activeTier = activePlanTier(plan);
  const shipToLocation = settings.shippingCountry
    ? [settings.shippingCountry, settings.shippingPostalCode ? `${settings.shippingPostalCode} region` : undefined].filter(Boolean).join(' ')
    : OUTPUT_STYLE.off;
  return [
    {
      name: 'Plan',
      value: [`**Access:** ${formatActivePlanAccess(plan)}`, `**Chases:** ${PLAN_LIMITS[activeTier].maxActiveChases} active`].join('\n'),
      inline: false
    },
    {
      name: 'Sources',
      value: [
        `**Watching:** ${displayListingSourceSetting(settings.listingSourceMode, activeTier)}`,
        `**Trusted Shops:** ${displayTrustedShopAccess(settings.listingSourceMode, activeTier)}`,
        ...(activeTier === 'PRO' ? ['**Source Controls:** pick a watch mode with the buttons below'] : [])
      ].join('\n'),
      inline: false
    },
    {
      name: 'Alert Rules',
      value: [`**Confidence:** ${settings.minScore} (default: 60)`, `**Volume:** ${displayAlertVolume(settings.maxAlertsPerHour)} (default: Balanced)`].join('\n'),
      inline: false
    },
    {
      name: 'Pricing',
      value: [
        `**Currency:** ${settings.alertCurrency} (default: USD)`,
        `**Ship-to:** ${shipToLocation} (default: Off)`,
        '**Privacy:** ship-to country is used for eBay shipping estimates. CA/US postal input is stored only as a region code'
      ].join('\n'),
      inline: false
    },
    {
      name: 'Updated',
      value: formatLocalDateTime(settings.updatedAt),
      inline: false
    }
  ];
}

export const alertsSettings = {
  async execute(interaction: any) {
    const currentSettings = getUserAlertSettings(interaction.user.id);
    const plan = getUserPlan(interaction.user.id);
    const activeTier = activePlanTier(plan);
    const minScore = interaction.options.getInteger('min_score');
    const alertVolume = interaction.options.getString('alert_volume') as AlertVolume | null;
    const alertCurrency = interaction.options.getString('alert_currency');
    const shippingCountryInput = interaction.options.getString('shipping_country');
    const shippingPostalCodeInput = interaction.options.getString('shipping_postal_code');
    const source = interaction.options.getString('source') as ListingSourceModePreference | null;

    const noChanges =
      minScore === null &&
      alertVolume === null &&
      alertCurrency === null &&
      shippingCountryInput === null &&
      shippingPostalCodeInput === null &&
      source === null;

    if (isStorefrontSourceMode(source) && activeTier !== 'PRO') {
      await interaction.reply({
        embeds: [
          warningEmbed(
            'Trusted Shops Are Pro',
            `trusted shops are a Pro control inside the Full Vault, useful for raw singles, promos, and restocks.\n\n**Free Vault:** eBay monitoring with ${PLAN_LIMITS.FREE.maxActiveChases} active chases\n**Full Vault:** ${FULL_VAULT_SUMMARY}\n${proControlsNextLine()}`
          )
        ],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const patch: Record<string, unknown> = {};
    if (minScore !== null) patch.minScore = minScore;
    if (alertVolume !== null) patch.alertVolume = alertVolume;
    if (alertCurrency !== null) patch.alertCurrency = alertCurrency;
    if (shippingCountryInput !== null) patch.shippingCountry = shippingCountryInput;
    if (shippingPostalCodeInput !== null) patch.shippingPostalCode = shippingPostalCodeInput;
    if (source !== null) patch.listingSourceMode = source;
    const update = noChanges ? null : updateAlertSettings(interaction.user.id, patch, { allowCurrency: true });
    if (update && !update.ok) {
      const title = update.field === 'shippingCountry' ? 'Invalid Country' : update.field === 'shippingPostalCode' ? 'Invalid Postal Code' : 'Invalid Settings';
      await interaction.reply({ embeds: [warningEmbed(title, update.message)], flags: MessageFlags.Ephemeral });
      return;
    }
    const settings = update?.ok ? update.settings : currentSettings;

    const embed = noChanges
      ? infoEmbed('🔔 Vaultr Settings', 'Your alert rules and source settings')
      : successEmbed('Vaultr Settings Updated', 'Your alert rules are updated').setTitle('✅ Vaultr Settings Updated');

    embed.addFields(...settingsFields(plan, settings));

    await interaction.reply({
      embeds: [embed],
      components: sourceRows(interaction.user.id, activeTier, settings.listingSourceMode),
      flags: MessageFlags.Ephemeral
    });
  }
};

export async function handleAlertSourceButtons(interaction: any): Promise<boolean> {
  if (!interaction.isButton()) return false;
  if (!interaction.customId.startsWith(`${ALERTS_SOURCE_PREFIX}:`)) return false;

  const [, ownerUserId, sourceRaw] = interaction.customId.split(':');
  if (interaction.user.id !== ownerUserId) {
    await interaction.reply({
      embeds: [warningEmbed('Settings Belong Elsewhere', 'Only the original requester can update these source controls')],
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  const source = sourceRaw as ListingSourceModePreference;
  if (source !== 'EBAY' && source !== 'EBAY_SHOPIFY' && source !== 'SHOPIFY') return false;

  const plan = getUserPlan(interaction.user.id);
  const activeTier = activePlanTier(plan);
  if (activeTier !== 'PRO') {
    await interaction.reply({
      embeds: [warningEmbed('Trusted Shops Are Pro', `trusted shops source controls are Pro controls inside the Full Vault.\n\n${proControlsNextLine()}`)],
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  const update = updateAlertSettings(interaction.user.id, { listingSourceMode: source });
  if (!update.ok) return true;
  const settings = update.settings;
  const embed = successEmbed('Vaultr Settings Updated', 'Watch mode updated').setTitle('✅ Vaultr Settings Updated');
  embed.addFields(...settingsFields(plan, settings));
  await interaction.update({ embeds: [embed], components: sourceRows(interaction.user.id, activeTier, settings.listingSourceMode) });
  return true;
}
