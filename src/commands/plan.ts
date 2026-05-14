import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { getUserPlan } from '../services/chase-store.js';
import { PLAN_LIMITS } from '../services/plans.js';
import { infoEmbed, keyValue } from '../ui/embeds.js';

export const plan = {
  data: new SlashCommandBuilder().setName('plan').setDescription('Show your Vaultr plan and limits'),
  async execute(interaction: any) {
    const userPlan = getUserPlan(interaction.user.id);
    const limits = PLAN_LIMITS[userPlan.tier];

    await interaction.reply({
      embeds: [
        infoEmbed('Your Plan').addFields(
          keyValue('Tier', userPlan.tier),
          keyValue('Status', userPlan.status),
          keyValue('Active Chase Limit', `${limits.maxActiveChases}`),
          keyValue('Polling Target', `${limits.pollIntervalSeconds}s`),
          keyValue('Updated', userPlan.updatedAt)
        )
      ],
      flags: MessageFlags.Ephemeral
    });
  }
};
