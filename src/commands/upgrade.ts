import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { getUserPlan } from '../services/chase-store.js';
import { PLAN_LIMITS } from '../services/plans.js';
import { infoEmbed, successEmbed } from '../ui/embeds.js';

export const upgrade = {
  data: new SlashCommandBuilder().setName('upgrade').setDescription('See Pro benefits and how to upgrade'),
  async execute(interaction: any) {
    const plan = getUserPlan(interaction.user.id);

    if (plan.tier === 'PRO' && plan.status === 'ACTIVE') {
      const lines = [
        `**Plan:** ${plan.tier} (${plan.status})`,
        `**Active Chases:** ${PLAN_LIMITS.PRO.maxActiveChases}`,
        `**Checks for New Listings:** Every ${PLAN_LIMITS.PRO.pollIntervalSeconds} seconds`
      ];
      await interaction.reply({
        embeds: [successEmbed('You Are Pro', lines.join('\n')).setTitle('👑 You Are Pro')],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const lines = [
      `**Free:** ${PLAN_LIMITS.FREE.maxActiveChases} active chases | Checks for new listings every ${PLAN_LIMITS.FREE.pollIntervalSeconds} seconds`,
      `**Pro:** ${PLAN_LIMITS.PRO.maxActiveChases} active chases | Checks for new listings every ${PLAN_LIMITS.PRO.pollIntervalSeconds} seconds`,
      '**How to Upgrade:** Billing flow coming soon.'
    ];

    await interaction.reply({
      embeds: [infoEmbed('💎 Upgrade to Vaultr Pro', `Pro removes hunt friction and improves alert speed.\n\n${lines.join('\n')}`)],
      flags: MessageFlags.Ephemeral
    });
  }
};
