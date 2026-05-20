import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { resetUserAlertSettings } from '../services/chase-store.js';
import { successEmbed } from '../ui/embeds.js';
import { OUTPUT_STYLE } from '../ui/style.js';

export const alertsSettingsReset = {
  data: new SlashCommandBuilder()
    .setName('alerts-settings-reset')
    .setDescription('Reset alert settings to recommended defaults'),
  async execute(interaction: any) {
    const settings = resetUserAlertSettings(interaction.user.id);
    const lines = [
      `**Min Score:** ${settings.minScore}`,
      `**Max Alerts/Hour:** ${settings.maxAlertsPerHour}`,
      `**Chase Cooldown:** ${settings.chaseCooldownMinutes}m`,
      `**Alert Currency:** ${settings.alertCurrency}`,
      `**Quiet Hours:** ${OUTPUT_STYLE.off}`
    ];
    await interaction.reply({
      embeds: [successEmbed('Alert Settings Reset', lines.join('\n')).setTitle('✅ Alert Settings Reset')],
      flags: MessageFlags.Ephemeral
    });
  }
};
