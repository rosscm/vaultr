import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { getUserPlan } from '../services/chase-store.js';
import { PLAN_LIMITS } from '../services/plans.js';
import { keyValue, infoEmbed, successEmbed } from '../ui/embeds.js';

export const upgrade = {
  data: new SlashCommandBuilder().setName('upgrade').setDescription('See Pro benefits and how to upgrade'),
  async execute(interaction: any) {
    const plan = getUserPlan(interaction.user.id);

    if (plan.tier === 'PRO' && plan.status === 'ACTIVE') {
      await interaction.reply({
        embeds: [
          successEmbed('You Are Pro').addFields(
            keyValue('Plan', `${plan.tier} (${plan.status})`),
            keyValue('Active Chases', `${PLAN_LIMITS.PRO.maxActiveChases}`),
            keyValue('Polling Target', `${PLAN_LIMITS.PRO.pollIntervalSeconds}s`)
          )
        ],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    await interaction.reply({
      embeds: [
        infoEmbed('Upgrade to Vaultr Pro', 'Pro removes hunt friction and improves alert speed.').addFields(
          keyValue('Free', `${PLAN_LIMITS.FREE.maxActiveChases} chases • ${PLAN_LIMITS.FREE.pollIntervalSeconds}s target`),
          keyValue('Pro', `${PLAN_LIMITS.PRO.maxActiveChases} chases • ${PLAN_LIMITS.PRO.pollIntervalSeconds}s target`),
          keyValue('How to Upgrade', 'Billing flow coming soon. Use /plan-set for beta testing.')
        )
      ],
      flags: MessageFlags.Ephemeral
    });
  }
};
