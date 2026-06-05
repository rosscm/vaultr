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
        'The crown fits. Your Vault has the full Pro toolkit unlocked.',
        '',
        `**Chase Room:** ${PLAN_LIMITS.PRO.maxActiveChases} active chases`,
        `**Listing Checks:** every ${formatPollInterval(PLAN_LIMITS.PRO.pollIntervalSeconds)}`,
        '**Discovery:** deeper Taste Profile shelf with remembered cues'
      ];
      await interaction.reply({
        embeds: [successEmbed('You Are Pro', lines.join('\n')).setTitle('👑 You Are Pro')],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const lines = [
      'Pro is built for collectors with more grails to track, more specific taste, and more places worth watching.',
      '',
      '**Your Free Vault**',
      `• ${PLAN_LIMITS.FREE.maxActiveChases} active chases`,
      `• eBay checks every ${formatPollInterval(PLAN_LIMITS.FREE.pollIntervalSeconds)}`,
      '• Discovery preview shaped by active chases',
      '',
      '**Pro Unlocks**',
      `• ${PLAN_LIMITS.PRO.maxActiveChases} active chases and faster checks every ${formatPollInterval(PLAN_LIMITS.PRO.pollIntervalSeconds)}`,
      '• deeper Discovery with a Taste Profile shelf that remembers cues and keeps learning from your Vault',
      '• trusted shop sources alongside eBay, including shop-only restock signals',
      '• precision controls for condition, listing type, blocked terms, priority, and chase notes',
      '',
      '**Status**',
      'Stripe checkout is coming soon; Pro access can be tested before launch.'
    ];

    await interaction.reply({
      embeds: [infoEmbed('💎 Upgrade to Vaultr Pro', lines.join('\n'))],
      flags: MessageFlags.Ephemeral
    });
  }
};
