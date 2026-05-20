import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { resetUserAlertSettings } from '../services/chase-store.js';
import { successEmbed, keyValue } from '../ui/embeds.js';
import { OUTPUT_STYLE } from '../ui/style.js';

export const alertsSettingsReset = {
  data: new SlashCommandBuilder()
    .setName('alerts-settings-reset')
    .setDescription('Reset alert settings to recommended defaults'),
  async execute(interaction: any) {
    const settings = resetUserAlertSettings(interaction.user.id);
    await interaction.reply({
      embeds: [
        successEmbed('Alert Settings Reset').addFields(
          keyValue('Min Score', `${settings.minScore}`),
          keyValue('Max Alerts/Hour', `${settings.maxAlertsPerHour}`),
          keyValue('Chase Cooldown', `${settings.chaseCooldownMinutes}m`),
          keyValue('Quiet Hours', OUTPUT_STYLE.off)
        )
      ],
      flags: MessageFlags.Ephemeral
    });
  }
};
