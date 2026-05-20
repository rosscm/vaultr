import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { getUserAlertSettings, setUserAlertSettings } from '../services/chase-store.js';
import { infoEmbed, keyValue, successEmbed } from '../ui/embeds.js';
import { formatLocalDateTime } from '../ui/time.js';
import { OUTPUT_STYLE } from '../ui/style.js';

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
        .setName('chase_cooldown_minutes')
        .setDescription('Minimum minutes between alerts for the same chase')
        .setMinValue(0)
        .setMaxValue(1440)
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
    const chaseCooldownMinutes = interaction.options.getInteger('chase_cooldown_minutes');
    const quietStart = interaction.options.getInteger('quiet_start');
    const quietEnd = interaction.options.getInteger('quiet_end');

    const noChanges =
      minScore === null && maxAlertsPerHour === null && chaseCooldownMinutes === null && quietStart === null && quietEnd === null;

    const settings = noChanges
      ? getUserAlertSettings(interaction.user.id)
      : setUserAlertSettings(interaction.user.id, {
          minScore: minScore ?? undefined,
          maxAlertsPerHour: maxAlertsPerHour ?? undefined,
          chaseCooldownMinutes: chaseCooldownMinutes ?? undefined,
          quietHoursStart: quietStart ?? undefined,
          quietHoursEnd: quietEnd ?? undefined
        });

    const quietHours =
      settings.quietHoursStart === undefined || settings.quietHoursEnd === undefined
        ? OUTPUT_STYLE.off
        : `${settings.quietHoursStart}:00-${settings.quietHoursEnd}:00`;

    await interaction.reply({
      embeds: [
        (noChanges ? infoEmbed('Alert Settings') : successEmbed('Alert Settings Updated')).addFields(
          keyValue('Min Score', `${settings.minScore}`),
          keyValue('Max Alerts/Hour', `${settings.maxAlertsPerHour}`),
          keyValue('Chase Cooldown', `${settings.chaseCooldownMinutes}m`),
          keyValue('Quiet Hours', quietHours),
          keyValue('Recommended Start', '`Min Score: 65` | `Cooldown: 30m`'),
          keyValue('Updated', formatLocalDateTime(settings.updatedAt))
        )
      ],
      flags: MessageFlags.Ephemeral
    });
  }
};
