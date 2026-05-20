import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { getUserAlertSettings, setUserAlertSettings } from '../services/chase-store.js';
import { infoEmbed, successEmbed } from '../ui/embeds.js';
import { formatLocalDateTime } from '../ui/time.js';
import { OUTPUT_STYLE } from '../ui/style.js';

export const alertsSettings = {
  data: new SlashCommandBuilder()
    .setName('alerts-settings')
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
    ),
  async execute(interaction: any) {
    const minScore = interaction.options.getInteger('min_score');
    const maxAlertsPerHour = interaction.options.getInteger('max_alerts_per_hour');
    const chaseCooldownMinutes = interaction.options.getInteger('chase_cooldown_minutes');
    const quietStart = interaction.options.getInteger('quiet_start');
    const quietEnd = interaction.options.getInteger('quiet_end');
    const alertCurrency = interaction.options.getString('alert_currency');

    const noChanges =
      minScore === null &&
      maxAlertsPerHour === null &&
      chaseCooldownMinutes === null &&
      quietStart === null &&
      quietEnd === null &&
      alertCurrency === null;

    const settings = noChanges
      ? getUserAlertSettings(interaction.user.id)
      : setUserAlertSettings(interaction.user.id, {
          minScore: minScore ?? undefined,
          maxAlertsPerHour: maxAlertsPerHour ?? undefined,
          chaseCooldownMinutes: chaseCooldownMinutes ?? undefined,
          alertCurrency: (alertCurrency as 'USD' | 'CAD' | 'EUR' | 'GBP' | 'JPY' | null) ?? undefined,
          quietHoursStart: quietStart ?? undefined,
          quietHoursEnd: quietEnd ?? undefined
        });

    const quietHours =
      settings.quietHoursStart === undefined || settings.quietHoursEnd === undefined
        ? OUTPUT_STYLE.off
        : `${settings.quietHoursStart}:00-${settings.quietHoursEnd}:00`;

    const lines = [
      `**Min Score:** ${settings.minScore}`,
      `**Max Alerts/Hour:** ${settings.maxAlertsPerHour}`,
      `**Chase Cooldown:** ${settings.chaseCooldownMinutes}m`,
      `**Alert Currency:** ${settings.alertCurrency}`,
      `**Quiet Hours:** ${quietHours}`,
      `**Updated:** ${formatLocalDateTime(settings.updatedAt)}`
    ];

    const embed = noChanges
      ? infoEmbed('🔔 Alert Settings', lines.join('\n'))
      : successEmbed('Alert Settings Updated', lines.join('\n')).setTitle('✅ Alert Settings Updated');

    await interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral
    });
  }
};
