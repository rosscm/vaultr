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
    .setDescription('Open your Vault and begin your first chase'),
  async execute(interaction: any) {
    const plan = getUserPlan(interaction.user.id);
    const settings = getUserAlertSettings(interaction.user.id);
    const activeChases = countUserChases(interaction.user.id);
    const limits = PLAN_LIMITS[plan.tier];

    const lines = [
      '**Build your Vault. Chase your grails. Discover what you love next.**',
      '',
      '**Step 1:** Add a card you are chasing with `/chase add`',
      '**Step 2:** Shape your signal with `/alerts settings`',
      '**Step 3:** Watch your DMs for grail moments and discoveries',
      '',
      `**Plan:** ${plan.tier} (${plan.status})`,
      `**Active Chases:** ${activeChases}/${limits.maxActiveChases}`,
      `**Min Score:** ${settings.minScore}`,
      `**Chase Cooldown:** ${settings.chaseCooldownMinutes}m`,
      `**Alert Currency:** ${settings.alertCurrency}`,
      `**Show Images:** ${settings.showImages ? OUTPUT_STYLE.on : OUTPUT_STYLE.off}`,
      `**Compact Mode:** ${settings.compactMode ? OUTPUT_STYLE.on : OUTPUT_STYLE.off}`,
      '',
      '**Tip:** Add the card number when it matters; it helps Vaultr understand the exact piece you mean'
    ];

    await interaction.reply({
      embeds: [infoEmbed('🗝️ Start Your Vault', lines.join('\n'))],
      flags: MessageFlags.Ephemeral
    });
  }
};
