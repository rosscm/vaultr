import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { getUserAlertSettings, getUserPlan, setUserAlertSettings } from '../services/chase-store.js';
import { activePlanTier, formatActivePlanAccess, PLAN_LIMITS } from '../services/plans.js';
import { infoEmbed, successEmbed, warningEmbed } from '../ui/embeds.js';
import { formatLocalDateTime } from '../ui/time.js';
import { OUTPUT_STYLE } from '../ui/style.js';
import type { ListingSourceModePreference } from '../types.js';

type AlertVolume = 'QUIET' | 'BALANCED' | 'MORE';

const ALERT_VOLUME_CHOICES = [
  { name: 'Quiet (3/hour)', value: 'QUIET' },
  { name: 'Balanced (10/hour)', value: 'BALANCED' },
  { name: 'More (25/hour)', value: 'MORE' }
] as const;

const SHIPPING_COUNTRY_CHOICES = [
  { name: 'Off', value: 'OFF' },
  { name: 'United States (USD)', value: 'US' },
  { name: 'Canada (CAD)', value: 'CA' },
  { name: 'United Kingdom (GBP)', value: 'GB' },
  { name: 'Japan (JPY)', value: 'JP' },
  { name: 'Germany (EUR)', value: 'DE' },
  { name: 'France (EUR)', value: 'FR' },
  { name: 'Italy (EUR)', value: 'IT' },
  { name: 'Spain (EUR)', value: 'ES' },
  { name: 'Netherlands (EUR)', value: 'NL' },
  { name: 'Australia', value: 'AU' }
] as const;

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
  const shipToLocation = settings.shippingCountry ?? OUTPUT_STYLE.off;
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
      value: [`**Currency:** ${settings.alertCurrency} (default: USD)`, `**Ship-to:** ${shipToLocation} (default: Off)`].join('\n'),
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
  data: new SlashCommandBuilder()
    .setName('alerts-settings')
    .setDescription('View or update your Vaultr controls')
    .addStringOption((opt) =>
      opt
        .setName('source')
        .setDescription('Where Vaultr watches for sightings (default: eBay; shops Pro)')
        .addChoices(
          { name: 'eBay', value: 'EBAY' },
          { name: 'eBay + Trusted Shops', value: 'EBAY_SHOPIFY' },
          { name: 'Trusted Shops Only', value: 'SHOPIFY' }
        )
    )
    .addIntegerOption((opt) =>
      opt
        .setName('min_score')
        .setDescription('Minimum confidence for a DM sighting (0-100; default: 60)')
        .setMinValue(0)
        .setMaxValue(100)
    )
    .addStringOption((opt) =>
      opt
        .setName('alert_volume')
        .setDescription('How many sightings Vaultr may DM you (default: Balanced, 10/hour)')
        .addChoices(...ALERT_VOLUME_CHOICES)
    )
    .addStringOption((opt) =>
      opt
        .setName('alert_currency')
        .setDescription('Currency for listing prices and max comparisons (default: USD)')
        .addChoices(
          { name: 'USD', value: 'USD' },
          { name: 'CAD', value: 'CAD' },
          { name: 'EUR', value: 'EUR' },
          { name: 'GBP', value: 'GBP' },
          { name: 'JPY', value: 'JPY' }
        )
    )
    .addStringOption((opt) =>
      opt
        .setName('shipping_country')
        .setDescription('Ship-to country for better shipping estimates (default: Off)')
        .addChoices(...SHIPPING_COUNTRY_CHOICES)
        .setMaxLength(3)
    ),
  async execute(interaction: any) {
    const plan = getUserPlan(interaction.user.id);
    const activeTier = activePlanTier(plan);
    const minScore = interaction.options.getInteger('min_score');
    const alertVolume = interaction.options.getString('alert_volume') as AlertVolume | null;
    const alertCurrency = interaction.options.getString('alert_currency');
    const shippingCountryInput = interaction.options.getString('shipping_country');
    const source = interaction.options.getString('source') as ListingSourceModePreference | null;
    const shippingCountry = normalizeShippingCountry(shippingCountryInput);

    const noChanges =
      minScore === null &&
      alertVolume === null &&
      alertCurrency === null &&
      shippingCountryInput === null &&
      source === null;

    if (shippingCountryInput !== null && shippingCountry === undefined) {
      await interaction.reply({
        embeds: [warningEmbed('Invalid Country', 'Use a two-letter country code like `CA` or `US`, or `OFF` to clear your ship-to country.')],
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
      ? getUserAlertSettings(interaction.user.id)
      : setUserAlertSettings(interaction.user.id, {
          minScore: minScore ?? undefined,
          maxAlertsPerHour: alertVolume === null ? undefined : maxAlertsForVolume(alertVolume),
          alertCurrency: (alertCurrency as 'USD' | 'CAD' | 'EUR' | 'GBP' | 'JPY' | null) ?? undefined,
          shippingCountry,
          listingSourceMode: source ?? undefined
        });

    const embed = noChanges
      ? infoEmbed('🔔 Vaultr Settings', 'Your alert rules and source settings.')
      : successEmbed('Vaultr Settings Updated', 'Your alert rules are updated.').setTitle('✅ Vaultr Settings Updated');

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
      embeds: [warningEmbed('Settings Belong Elsewhere', 'Only the original requester can update these source controls.')],
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
      embeds: [warningEmbed('Shop Sources Are Pro', 'Trusted shop source controls are available on Pro.')],
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  const settings = setUserAlertSettings(interaction.user.id, { listingSourceMode: source });
  const embed = successEmbed('Vaultr Settings Updated', 'Watch mode updated.').setTitle('✅ Vaultr Settings Updated');
  embed.addFields(...settingsFields(plan, settings));
  await interaction.update({ embeds: [embed], components: sourceRows(interaction.user.id, activeTier, settings.listingSourceMode) });
  return true;
}
