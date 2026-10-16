import { SlashCommandBuilder } from 'discord.js';
import { alertsRecent } from './alerts-recent.js';
import { alertsSettings } from './alerts-settings.js';
import { alertsStatus } from './alerts-status.js';
import { alertsTest } from './alerts-test.js';
import { previewAlert } from './alerts-preview.js';
import { ALERT_SHIPPING_COUNTRY_OPTIONS } from '../services/alert-settings.js';

export const alerts = {
  data: new SlashCommandBuilder()
    .setName('alerts')
    .setDescription('Tune your alert rules and watch sources')
    .addSubcommand((sub) =>
      sub
        .setName('settings')
        .setDescription('Tune alert rules, pricing, and sources')
        .addStringOption((opt) =>
          opt
            .setName('source')
            .setDescription('Where Vaultr watches for listings (default: eBay, shops are Pro)')
            .addChoices(
              { name: 'eBay', value: 'EBAY' },
              { name: 'eBay + Trusted Shops', value: 'EBAY_SHOPIFY' },
              { name: 'Trusted Shops Only', value: 'SHOPIFY' }
            )
        )
        .addIntegerOption((opt) =>
          opt
            .setName('min_score')
            .setDescription('Minimum confidence for Inbox and Discord matches (0-100; default: 60)')
            .setMinValue(0)
            .setMaxValue(100)
        )
        .addStringOption((opt) =>
          opt
            .setName('alert_volume')
            .setDescription('How many matches Vaultr may surface (default: Balanced, 10/hr)')
            .addChoices(
              { name: 'Quiet (3/hr)', value: 'QUIET' },
              { name: 'Balanced (10/hr)', value: 'BALANCED' },
              { name: 'More (25/hr)', value: 'MORE' }
            )
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
            .addChoices(...ALERT_SHIPPING_COUNTRY_OPTIONS.map((choice) => ({ name: choice.label, value: choice.value })))
            .setMaxLength(3)
        )
        .addStringOption((opt) =>
          opt
            .setName('shipping_postal_code')
            .setDescription("Postal/ZIP region for eBay shipping; type the word 'off' to remove saved value (default: Off)")
            .setMaxLength(16)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('recent')
        .setDescription('Review recent Vault matches')
    )
    .addSubcommand((sub) =>
      sub
        .setName('status')
        .setDescription('Check your Vault watch state')
    )
    .addSubcommand((sub) =>
      sub
        .setName('test')
        .setDescription('Send a DM delivery test')
    )
    .addSubcommand((sub) =>
      sub
        .setName('preview')
        .setDescription('Preview a chase alert DM')
    ),
  async execute(interaction: any) {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === 'settings') return alertsSettings.execute(interaction);
    if (subcommand === 'recent') return alertsRecent.execute(interaction);
    if (subcommand === 'status') return alertsStatus.execute(interaction);
    if (subcommand === 'test') return alertsTest.execute(interaction);
    if (subcommand === 'preview') return previewAlert.execute(interaction);
  }
};
