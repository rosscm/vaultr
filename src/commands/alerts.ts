import { SlashCommandBuilder } from 'discord.js';
import { alertsRecent } from './alerts-recent.js';
import { alertsSettings } from './alerts-settings.js';
import { previewAlert } from './preview-alert.js';

export const alerts = {
  data: new SlashCommandBuilder()
    .setName('alerts')
    .setDescription('Manage your alert experience')
    .addSubcommand((sub) =>
      sub
        .setName('settings')
        .setDescription('View or update your alert controls')
        .addIntegerOption((opt) =>
          opt
            .setName('min_score')
            .setDescription('Minimum match score to alert (0-100) (default: 60)')
            .setMinValue(0)
            .setMaxValue(100)
        )
        .addIntegerOption((opt) =>
          opt
            .setName('max_alerts_per_hour')
            .setDescription('Maximum alerts per hour (default: 10)')
            .setMinValue(1)
            .setMaxValue(200)
        )
        .addIntegerOption((opt) =>
          opt
            .setName('chase_cooldown_minutes')
            .setDescription('Minimum minutes between alerts for the same chase (default: 30)')
            .setMinValue(0)
            .setMaxValue(1440)
        )
        .addIntegerOption((opt) =>
          opt
            .setName('quiet_start')
            .setDescription('Quiet hours start (0-23, local server time) (default: Off)')
            .setMinValue(0)
            .setMaxValue(23)
        )
        .addIntegerOption((opt) =>
          opt
            .setName('quiet_end')
            .setDescription('Quiet hours end (0-23, local server time) (default: Off)')
            .setMinValue(0)
            .setMaxValue(23)
        )
        .addStringOption((opt) =>
          opt
            .setName('alert_currency')
            .setDescription('Currency for alert pricing (default: USD)')
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
            .setName('show_images')
            .setDescription('Show listing images in DM alerts (default: On)')
            .addChoices(
              { name: 'On', value: 'ON' },
              { name: 'Off', value: 'OFF' }
            )
        )
        .addStringOption((opt) =>
          opt
            .setName('compact_mode')
            .setDescription('Use compact DM layout (default: Off)')
            .addChoices(
              { name: 'On', value: 'ON' },
              { name: 'Off', value: 'OFF' }
            )
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('recent')
        .setDescription('Show your recent delivered alerts')
        .addIntegerOption((opt) =>
          opt
            .setName('limit')
            .setDescription('How many alerts to show (max 20)')
            .setMinValue(1)
            .setMaxValue(20)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('preview')
        .setDescription('Preview your current DM alert format')
    ),
  async execute(interaction: any) {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === 'settings') return alertsSettings.execute(interaction);
    if (subcommand === 'recent') return alertsRecent.execute(interaction);
    if (subcommand === 'preview') return previewAlert.execute(interaction);
  }
};

