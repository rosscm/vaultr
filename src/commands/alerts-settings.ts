import { SlashCommandBuilder } from 'discord.js';
import { getUserAlertSettings, setUserAlertSettings } from '../services/chase-store.js';

export const alertsSettings = {
  data: new SlashCommandBuilder()
    .setName('alerts-settings')
    .setDescription('View or update your alert controls')
    .addIntegerOption((opt) =>
      opt
        .setName('min_score')
        .setDescription('Minimum match score to alert (0-100)')
        .setMinValue(0)
        .setMaxValue(100)
    )
    .addIntegerOption((opt) =>
      opt
        .setName('max_alerts_per_hour')
        .setDescription('Maximum alerts per hour')
        .setMinValue(1)
        .setMaxValue(200)
    )
    .addIntegerOption((opt) =>
      opt
        .setName('quiet_start')
        .setDescription('Quiet hours start (0-23, local server time)')
        .setMinValue(0)
        .setMaxValue(23)
    )
    .addIntegerOption((opt) =>
      opt
        .setName('quiet_end')
        .setDescription('Quiet hours end (0-23, local server time)')
        .setMinValue(0)
        .setMaxValue(23)
    ),
  async execute(interaction: any) {
    const minScore = interaction.options.getInteger('min_score');
    const maxAlertsPerHour = interaction.options.getInteger('max_alerts_per_hour');
    const quietStart = interaction.options.getInteger('quiet_start');
    const quietEnd = interaction.options.getInteger('quiet_end');

    const noChanges = minScore === null && maxAlertsPerHour === null && quietStart === null && quietEnd === null;

    const settings = noChanges
      ? getUserAlertSettings(interaction.user.id)
      : setUserAlertSettings(interaction.user.id, {
          minScore: minScore ?? undefined,
          maxAlertsPerHour: maxAlertsPerHour ?? undefined,
          quietHoursStart: quietStart ?? undefined,
          quietHoursEnd: quietEnd ?? undefined
        });

    const quietHours =
      settings.quietHoursStart === undefined || settings.quietHoursEnd === undefined
        ? 'off'
        : `${settings.quietHoursStart}:00-${settings.quietHoursEnd}:00`;

    await interaction.reply(
      `Alert settings:\n` +
        `min_score: **${settings.minScore}**\n` +
        `max_alerts_per_hour: **${settings.maxAlertsPerHour}**\n` +
        `quiet_hours: **${quietHours}**\n` +
        `updated: ${settings.updatedAt}`
    );
  }
};
