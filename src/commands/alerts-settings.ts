import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { getUserAlertSettings, getUserPlan, setUserAlertSettings } from '../services/chase-store.js';
import { activePlanTier, formatActivePlanAccess, PLAN_LIMITS } from '../services/plans.js';
import { infoEmbed, successEmbed, warningEmbed } from '../ui/embeds.js';
import { formatLocalDateTime } from '../ui/time.js';
import { OUTPUT_STYLE } from '../ui/style.js';
import type { ListingSourceModePreference } from '../types.js';

type AlertVolume = 'QUIET' | 'BALANCED' | 'MORE';

const ALERTS_SOURCE_PREFIX = 'alerts-source';

function maxAlertsForVolume(value: AlertVolume): number {
  if (value === 'QUIET') return 3;
  if (value === 'MORE') return 25;
  return 10;
}

function displayAlertVolume(maxAlertsPerHour: number): string {
  if (maxAlertsPerHour <= 5) return `Quiet (${maxAlertsPerHour}/hour)`;
  if (maxAlertsPerHour >= 20) return `More (${maxAlertsPerHour}/hour)`;
  return `Balanced (${maxAlertsPerHour}/hour)`;
}

function normalizeShippingCountry(value: string | null): string | null | undefined {
  if (value === null) return undefined;
  const normalized = value.trim().toUpperCase();
  if (normalized === 'OFF' || normalized === 'NONE' || normalized === 'CLEAR') return null;
  return /^[A-Z]{2}$/.test(normalized) ? normalized : undefined;
}

function normalizeShippingPostalCode(value: string | null, shippingCountry?: string): string | null | undefined {
  if (value === null) return undefined;
  const normalized = value.trim().toUpperCase().replace(/\s+/g, ' ');
  if (normalized === 'OFF' || normalized === 'NONE' || normalized === 'CLEAR') return null;
  if (shippingCountry === 'CA') {
    const compact = normalized.replace(/[\s-]+/g, '');
    const match = /^([A-Z]\d[A-Z])(?:\d[A-Z]\d)?$/.exec(compact);
    return match?.[1];
  }
  if (shippingCountry === 'US') {
    const match = /^(\d{5})(?:[- ]?\d{4})?$/.exec(normalized);
    return match?.[1];
  }
  return undefined;
}

function displaySourceMode(value: ListingSourceModePreference): string {
  if (value === 'EBAY') return 'eBay';
  if (value === 'EBAY_SHOPIFY') return 'eBay + Trusted Shops';
  if (value === 'SHOPIFY') return 'Trusted Shops Only';
  return 'eBay';
}

function isStorefrontSourceMode(value: ListingSourceModePreference | null): boolean {
  return value === 'EBAY_SHOPIFY' || value === 'SHOPIFY';
}

function displayListingSourceSetting(value: ListingSourceModePreference, activeTier: 'FREE' | 'PRO'): string {
  if (activeTier === 'FREE' && isStorefrontSourceMode(value)) return 'eBay (stored shop preference paused)';
  return displaySourceMode(value);
}

function displayTrustedShopAccess(value: ListingSourceModePreference, activeTier: 'FREE' | 'PRO'): string {
  if (activeTier === 'FREE') {
    return isStorefrontSourceMode(value)
      ? `Paused until Pro (${PLAN_LIMITS.PRO.maxActiveChases} active chases + shop sources)`
      : `Unlock with Pro (${PLAN_LIMITS.PRO.maxActiveChases} active chases + shop sources)`;
  }
  if (value === 'EBAY_SHOPIFY') return 'Enabled with eBay';
  if (value === 'SHOPIFY') return 'Enabled, trusted shops only';
  return 'Available; switch source to eBay + Trusted Shops or Trusted Shops Only';
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
        currentSource === 'EBAY_SHOPIFY' ? 'eBay + Shops Active' : 'Use eBay + Shops',
        ButtonStyle.Primary,
        currentSource === 'EBAY_SHOPIFY'
      ),
      sourceButton(userId, 'SHOPIFY', currentSource === 'SHOPIFY' ? 'Trusted Shops Active' : 'Use Shops Only', ButtonStyle.Secondary, currentSource === 'SHOPIFY')
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
        '**Privacy:** ship-to country is used for eBay shipping estimates; CA/US postal input is stored only as a region code'
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
    const shippingCountry = normalizeShippingCountry(shippingCountryInput);
    const effectiveShippingCountry = shippingCountry === undefined ? currentSettings.shippingCountry : shippingCountry ?? undefined;
    const shippingPostalCode = normalizeShippingPostalCode(shippingPostalCodeInput, effectiveShippingCountry);

    const noChanges =
      minScore === null &&
      alertVolume === null &&
      alertCurrency === null &&
      shippingCountryInput === null &&
      shippingPostalCodeInput === null &&
      source === null;

    if (shippingCountryInput !== null && shippingCountry === undefined) {
      await interaction.reply({
        embeds: [warningEmbed('Invalid Country', 'Use a two-letter country code like `CA` or `US`, or `OFF` to clear your ship-to country')],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (shippingPostalCodeInput !== null && shippingPostalCode === undefined) {
      await interaction.reply({
        embeds: [warningEmbed('Invalid Postal Code', 'Postal regions are currently supported for `CA` and `US` only. Use a matching value like `M5V`, `M5V 2T6`, or `90210`, or `OFF` to clear it')],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (isStorefrontSourceMode(source) && activeTier !== 'PRO') {
      await interaction.reply({
        embeds: [
          warningEmbed(
            'Shop Sources Are Pro',
            `Pro watches trusted card shops alongside eBay, useful for raw singles, promos, and restocks.\n\n**Free:** eBay monitoring with ${PLAN_LIMITS.FREE.maxActiveChases} active chases\n**Pro:** eBay + Trusted Shops, Trusted Shops Only, faster checks, and ${PLAN_LIMITS.PRO.maxActiveChases} active chases\n**Next:** use \`/upgrade\` to unlock`
          )
        ],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const settings = noChanges
      ? currentSettings
      : setUserAlertSettings(interaction.user.id, {
          minScore: minScore ?? undefined,
          maxAlertsPerHour: alertVolume === null ? undefined : maxAlertsForVolume(alertVolume),
          alertCurrency: (alertCurrency as 'USD' | 'CAD' | 'EUR' | 'GBP' | 'JPY' | null) ?? undefined,
          shippingCountry,
          shippingPostalCode,
          listingSourceMode: source ?? undefined
        });

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
      embeds: [warningEmbed('Shop Sources Are Pro', 'Trusted shop source controls are available on Pro')],
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  const settings = setUserAlertSettings(interaction.user.id, { listingSourceMode: source });
  const embed = successEmbed('Vaultr Settings Updated', 'Watch mode updated').setTitle('✅ Vaultr Settings Updated');
  embed.addFields(...settingsFields(plan, settings));
  await interaction.update({ embeds: [embed], components: sourceRows(interaction.user.id, activeTier, settings.listingSourceMode) });
  return true;
}
