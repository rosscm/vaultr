import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { getUserAlertSettings, getUserPlan, setUserAlertSettings } from '../services/chase-store.js';
import { infoEmbed, successEmbed, warningEmbed } from '../ui/embeds.js';
import { getEntitlementsForTier } from '../services/entitlements.js';
import { formatLocalDateTime } from '../ui/time.js';
import { OUTPUT_STYLE } from '../ui/style.js';
import type { ListingSourceModePreference } from '../types.js';

function normalizeShippingCountry(value: string | null): string | null | undefined {
  if (value === null) return undefined;
  const normalized = value.trim().toUpperCase();
  if (normalized === 'OFF' || normalized === 'NONE' || normalized === 'CLEAR') return null;
  return /^[A-Z]{2}$/.test(normalized) ? normalized : undefined;
}

function normalizeShippingPostalCode(value: string | null): string | null | undefined {
  if (value === null) return undefined;
  const normalized = value.trim().toUpperCase();
  if (normalized === 'OFF' || normalized === 'NONE' || normalized === 'CLEAR') return null;
  return normalized.length > 0 ? normalized : undefined;
}

function displaySourceMode(value: ListingSourceModePreference): string {
  if (value === 'EBAY') return 'eBay';
  if (value === 'EBAY_SHOPIFY') return 'eBay + Trusted Shops';
  if (value === 'SHOPIFY') return 'Trusted Shops Only';
  return 'Default';
}

function isStorefrontSourceMode(value: ListingSourceModePreference | null): boolean {
  return value === 'EBAY_SHOPIFY' || value === 'SHOPIFY';
}

export const alertsSettings = {
  data: new SlashCommandBuilder()
    .setName('alerts-settings')
    .setDescription('View or update your sighting controls')
    .addIntegerOption((opt) =>
      opt
        .setName('min_score')
        .setDescription('Minimum confidence for a DM sighting (0-100; default 60)')
        .setMinValue(0)
        .setMaxValue(100)
    )
    .addIntegerOption((opt) =>
      opt
        .setName('max_alerts_per_hour')
        .setDescription('Most DM sightings Vaultr can send per hour (default: 10)')
        .setMinValue(1)
        .setMaxValue(200)
    )
    .addIntegerOption((opt) =>
      opt
        .setName('chase_cooldown_minutes')
        .setDescription('Minutes before the same chase can surface again (default: 30)')
        .setMinValue(0)
        .setMaxValue(1440)
    )
    .addIntegerOption((opt) =>
      opt
        .setName('quiet_start')
        .setDescription('Hour to pause sighting DMs (0-23, server time; default Off)')
        .setMinValue(0)
        .setMaxValue(23)
    )
    .addIntegerOption((opt) =>
      opt
        .setName('quiet_end')
        .setDescription('Hour to resume sighting DMs (0-23, server time; default Off)')
        .setMinValue(0)
        .setMaxValue(23)
    )
    .addStringOption((opt) =>
      opt
        .setName('alert_currency')
        .setDescription('Currency for sighting prices (default: USD)')
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
        .setDescription('Country for shipping checks, e.g. CA or OFF')
        .setMaxLength(3)
    )
    .addStringOption((opt) =>
      opt
        .setName('shipping_postal_code')
        .setDescription('Postal/ZIP prefix for shipping checks, e.g. M5V or OFF')
        .setMaxLength(16)
    )
    .addStringOption((opt) =>
      opt
        .setName('show_images')
        .setDescription('Show listing images in DM sightings (default: On)')
        .addChoices(
          { name: 'On', value: 'ON' },
          { name: 'Off', value: 'OFF' }
        )
    )
    .addStringOption((opt) =>
      opt
        .setName('compact_mode')
        .setDescription('Use the shorter sighting DM layout (default: Off)')
        .addChoices(
          { name: 'On', value: 'ON' },
          { name: 'Off', value: 'OFF' }
        )
    )
    .addStringOption((opt) =>
      opt
        .setName('source')
        .setDescription('Where Vaultr watches for sightings (trusted shops are Pro)')
        .addChoices(
          { name: 'Default', value: 'DEFAULT' },
          { name: 'eBay', value: 'EBAY' },
          { name: 'eBay + Trusted Shops', value: 'EBAY_SHOPIFY' },
          { name: 'Trusted Shops Only', value: 'SHOPIFY' }
        )
    ),
  async execute(interaction: any) {
    const plan = getUserPlan(interaction.user.id);
    const entitlements = getEntitlementsForTier(plan.tier);
    const minScore = interaction.options.getInteger('min_score');
    const maxAlertsPerHour = interaction.options.getInteger('max_alerts_per_hour');
    const chaseCooldownMinutes = interaction.options.getInteger('chase_cooldown_minutes');
    const quietStart = interaction.options.getInteger('quiet_start');
    const quietEnd = interaction.options.getInteger('quiet_end');
    const alertCurrency = interaction.options.getString('alert_currency');
    const shippingCountryInput = interaction.options.getString('shipping_country');
    const shippingPostalCodeInput = interaction.options.getString('shipping_postal_code');
    const showImages = interaction.options.getString('show_images');
    const compactMode = interaction.options.getString('compact_mode');
    const source = interaction.options.getString('source') as ListingSourceModePreference | null;
    const shippingCountry = normalizeShippingCountry(shippingCountryInput);
    const shippingPostalCode = normalizeShippingPostalCode(shippingPostalCodeInput);

    const noChanges =
      minScore === null &&
      maxAlertsPerHour === null &&
      chaseCooldownMinutes === null &&
      quietStart === null &&
      quietEnd === null &&
      alertCurrency === null &&
      shippingCountryInput === null &&
      shippingPostalCodeInput === null &&
      showImages === null &&
      compactMode === null &&
      source === null;

    if (shippingCountryInput !== null && shippingCountry === undefined) {
      await interaction.reply({
        embeds: [warningEmbed('Invalid Country', 'Use a two-letter country code like `CA` or `US`, or `OFF` to clear your shipping destination.')],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (shippingPostalCodeInput !== null && shippingPostalCode === undefined) {
      await interaction.reply({
        embeds: [warningEmbed('Invalid Postal Code', 'Use a short postal/ZIP prefix like `M5V`, or `OFF` to clear it.')],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const isAdvancedAlertControlChange =
      showImages !== null ||
      compactMode !== null ||
      quietStart !== null ||
      quietEnd !== null;

    if (!noChanges && isAdvancedAlertControlChange && !entitlements.advancedAlertControls) {
      await interaction.reply({
        embeds: [
          warningEmbed(
            'Pro Feature',
            'Advanced sighting controls are available on Pro\n\n**Includes:** images toggle, compact mode, quiet hours\n**Next:** use `/upgrade` to unlock'
          )
        ],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (isStorefrontSourceMode(source) && !entitlements.storefrontMonitoring) {
      await interaction.reply({
        embeds: [
          warningEmbed(
            'Pro Feature',
            'Trusted shop monitoring is available on Pro\n\n**Includes:** eBay + Trusted Shops, or Trusted Shops Only\n**Next:** use `/upgrade` to unlock'
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
          maxAlertsPerHour: maxAlertsPerHour ?? undefined,
          chaseCooldownMinutes: chaseCooldownMinutes ?? undefined,
          alertCurrency: (alertCurrency as 'USD' | 'CAD' | 'EUR' | 'GBP' | 'JPY' | null) ?? undefined,
          shippingCountry,
          shippingPostalCode: shippingCountry === null ? null : shippingPostalCode,
          showImages: showImages === null ? undefined : showImages === 'ON',
          compactMode: compactMode === null ? undefined : compactMode === 'ON',
          listingSourceMode: source ?? undefined,
          quietHoursStart: quietStart ?? undefined,
          quietHoursEnd: quietEnd ?? undefined
        });

    const quietHours =
      settings.quietHoursStart === undefined || settings.quietHoursEnd === undefined
        ? OUTPUT_STYLE.off
        : `${settings.quietHoursStart}:00-${settings.quietHoursEnd}:00`;
    const shipToLocation = settings.shippingCountry
      ? `${settings.shippingCountry}${settings.shippingPostalCode ? ` ${settings.shippingPostalCode}` : ''}`
      : OUTPUT_STYLE.off;

    const lines = [
      `**Minimum Confidence:** ${settings.minScore}`,
      `**Max Sightings/Hour:** ${settings.maxAlertsPerHour}`,
      `**Chase Cooldown:** ${settings.chaseCooldownMinutes}m`,
      `**Sighting Currency:** ${settings.alertCurrency}`,
      `**Shipping Destination:** ${shipToLocation}`,
      `**Listing Source:** ${displaySourceMode(settings.listingSourceMode)}`,
      `**Show Images:** ${settings.showImages ? OUTPUT_STYLE.on : OUTPUT_STYLE.off}`,
      `**Compact Mode:** ${settings.compactMode ? OUTPUT_STYLE.on : OUTPUT_STYLE.off}`,
      `**Quiet Hours:** ${quietHours}`,
      `**Updated:** ${formatLocalDateTime(settings.updatedAt)}`
    ];

    const embed = noChanges
      ? infoEmbed('🔔 Vault Signal Settings', lines.join('\n'))
      : successEmbed('Vault Signal Settings Updated', lines.join('\n')).setTitle('✅ Vault Signal Settings Updated');

    await interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral
    });
  }
};
