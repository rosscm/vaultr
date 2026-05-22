import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import {
  countUserChases,
  getUserAlertSettings,
  getUserPlan
} from '../services/chase-store.js';
import { PLAN_LIMITS } from '../services/plans.js';
import { infoEmbed } from '../ui/embeds.js';
import { OUTPUT_STYLE } from '../ui/style.js';

export const start = {
  data: new SlashCommandBuilder()
    .setName('start')
    .setDescription('Quick onboarding for your vault setup'),
  async execute(interaction: any) {
    const plan = getUserPlan(interaction.user.id);
    const settings = getUserAlertSettings(interaction.user.id);
    const activeChases = countUserChases(interaction.user.id);
    const limits = PLAN_LIMITS[plan.tier];

    const lines = [
      '**Step 1:** Add your first chase with `/chase add`',
      '**Step 2:** Tune alert controls with `/alerts settings`',
      '**Step 3:** Watch your DMs for matches',
      '',
      `**Plan:** ${plan.tier} (${plan.status})`,
      `**Active Chases:** ${activeChases}/${limits.maxActiveChases}`,
      `**Min Score:** ${settings.minScore}`,
      `**Chase Cooldown:** ${settings.chaseCooldownMinutes}m`,
      `**Alert Currency:** ${settings.alertCurrency}`,
      `**Show Images:** ${settings.showImages ? OUTPUT_STYLE.on : OUTPUT_STYLE.off}`,
      `**Compact Mode:** ${settings.compactMode ? OUTPUT_STYLE.on : OUTPUT_STYLE.off}`,
      '',
      '**Tip:** Add card number in the `card` field when relevant for cleaner matches'
    ];

    await interaction.reply({
      embeds: [infoEmbed('🚀 Start Your Vault', lines.join('\n'))],
      flags: MessageFlags.Ephemeral
    });
  }
};
