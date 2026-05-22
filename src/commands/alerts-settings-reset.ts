import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { getUserPlan, resetUserAlertSettings, setUserAlertSettings } from '../services/chase-store.js';
import { getEntitlementsForTier } from '../services/entitlements.js';
import { successEmbed } from '../ui/embeds.js';
import { OUTPUT_STYLE } from '../ui/style.js';

export const alertsSettingsReset = {
  data: new SlashCommandBuilder()
    .setName('alerts-settings-reset')
    .setDescription('Reset alert settings to recommended defaults'),
  async execute(interaction: any) {
    const plan = getUserPlan(interaction.user.id);
    const entitlements = getEntitlementsForTier(plan.tier);
    const settings = entitlements.advancedAlertControls
      ? resetUserAlertSettings(interaction.user.id)
      : setUserAlertSettings(interaction.user.id, {
          minScore: 60,
          maxAlertsPerHour: 10,
          chaseCooldownMinutes: 30,
          alertCurrency: 'USD'
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
      `**Show Images:** ${settings.showImages ? OUTPUT_STYLE.on : OUTPUT_STYLE.off}`,
      `**Compact Mode:** ${settings.compactMode ? OUTPUT_STYLE.on : OUTPUT_STYLE.off}`,
      `**Quiet Hours:** ${quietHours}`,
      '',
      ...(entitlements.advancedAlertControls ? [] : ['**Note:** Advanced alert controls are unchanged on Free', '']),
      '**Next:** Use `/alerts-settings` to customize from this baseline'
    ];
    await interaction.reply({
      embeds: [successEmbed('Alert Settings Reset', lines.join('\n')).setTitle('✅ Alert Settings Reset')],
      flags: MessageFlags.Ephemeral
    });
  }
};
