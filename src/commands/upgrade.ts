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
        `**Polling Target:** ${PLAN_LIMITS.PRO.pollIntervalSeconds}s`
      ];
      await interaction.reply({
        embeds: [successEmbed('You Are Pro', lines.join('\n')).setTitle('✅ You Are Pro')],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const lines = [
      `**Free:** ${PLAN_LIMITS.FREE.maxActiveChases} chases | ${PLAN_LIMITS.FREE.pollIntervalSeconds}s target`,
      `**Pro:** ${PLAN_LIMITS.PRO.maxActiveChases} chases | ${PLAN_LIMITS.PRO.pollIntervalSeconds}s target`,
      '**How to Upgrade:** Billing flow coming soon. Use /plan-set for beta testing.'
    ];

    await interaction.reply({
      embeds: [infoEmbed('💎 Upgrade to Vaultr Pro', `Pro removes hunt friction and improves alert speed.\n\n${lines.join('\n')}`)],
      flags: MessageFlags.Ephemeral
    });
  }
};
