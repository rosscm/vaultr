import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { getUserPlan } from '../services/chase-store.js';
import { PLAN_LIMITS } from '../services/plans.js';

export const plan = {
  data: new SlashCommandBuilder().setName('plan').setDescription('Show your Vaultr plan and limits'),
  async execute(interaction: any) {
    const userPlan = getUserPlan(interaction.user.id);
    const limits = PLAN_LIMITS[userPlan.tier];

    await interaction.reply({
      content:
        `Plan: **${userPlan.tier}** (${userPlan.status})\n` +
        `Active chase limit: **${limits.maxActiveChases}**\n` +
        `Polling target: every **${limits.pollIntervalSeconds}s**\n` +
        `Updated: ${userPlan.updatedAt}`,
      flags: MessageFlags.Ephemeral
    });
  }
};
