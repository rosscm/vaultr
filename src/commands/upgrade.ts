import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { getUserPlan } from '../services/chase-store.js';
import { formatPollInterval, PLAN_LIMITS } from '../services/plans.js';
import { infoEmbed, successEmbed } from '../ui/embeds.js';

export const upgrade = {
  data: new SlashCommandBuilder().setName('upgrade').setDescription('See how Vaultr Pro deepens your Vault'),
  async execute(interaction: any) {
    const plan = getUserPlan(interaction.user.id);

    if (plan.tier === 'PRO' && plan.status === 'ACTIVE') {
      const lines = [
        'Your Vault has the full Pro toolkit unlocked and ready to work',
        '',
        `**Active Chases:** ${PLAN_LIMITS.PRO.maxActiveChases}`,
        `**Listing Checks:** every ${formatPollInterval(PLAN_LIMITS.PRO.pollIntervalSeconds)}`,
        '**Discovery:** deeper recommendations with Taste Profile memory'
      ];
      await interaction.reply({
        embeds: [successEmbed('You Are Pro', lines.join('\n')).setTitle('👑 You Are Pro')],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const lines = [
      'Pro is built for collectors with more grails to track, sharper preferences, and more sources worth watching',
      '',
      '**Your Free Vault**',
      `• ${PLAN_LIMITS.FREE.maxActiveChases} active chases`,
      `• eBay checks every ${formatPollInterval(PLAN_LIMITS.FREE.pollIntervalSeconds)}`,
      '• Discovery preview shaped by active chases',
      '',
      '**Pro Unlocks**',
      `• ${PLAN_LIMITS.PRO.maxActiveChases} active chases and faster checks every ${formatPollInterval(PLAN_LIMITS.PRO.pollIntervalSeconds)}`,
      '• deeper Discovery with Taste Profile memory that keeps learning from your Vault',
      '• trusted shop sources alongside eBay, including shop-only restock signals',
      '• feedback-powered tune-out rules plus precision controls for condition, listing type, tune-out terms, priority, and chase notes',
      '',
      '**Status**',
      'Checkout is coming soon; Pro access is currently available by request'
    ];

    await interaction.reply({
      embeds: [infoEmbed('💎 Upgrade to Vaultr Pro', lines.join('\n'))],
      flags: MessageFlags.Ephemeral
    });
  }
};
