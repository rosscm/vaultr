import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { getUserPlan } from '../services/chase-store.js';
import { PLAN_LIMITS } from '../services/plans.js';
import { infoEmbed } from '../ui/embeds.js';
import { formatLocalDateTime } from '../ui/time.js';

export const plan = {
  data: new SlashCommandBuilder().setName('plan').setDescription('Show your Vaultr plan and limits'),
  async execute(interaction: any) {
    const userPlan = getUserPlan(interaction.user.id);
    const limits = PLAN_LIMITS[userPlan.tier];
    const lines = [
      `**Tier:** ${userPlan.tier}`,
      `**Status:** ${userPlan.status}`,
      `**Active Chase Limit:** ${limits.maxActiveChases}`,
      `**Polling Target:** ${limits.pollIntervalSeconds}s`,
      `**Updated:** ${formatLocalDateTime(userPlan.updatedAt)}`
    ];

    await interaction.reply({
      embeds: [infoEmbed('Your Plan', lines.join('\n'))],
      flags: MessageFlags.Ephemeral
    });
  }
};
