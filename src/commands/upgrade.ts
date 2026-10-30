import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { getUserPlan } from '../services/chase-store.js';
import { formatPollInterval, PLAN_LIMITS } from '../services/plans.js';
import { infoEmbed, successEmbed } from '../ui/embeds.js';
import { upgradeFreeVaultLines, upgradeFullVaultLines } from './pro-copy.js';

export const upgrade = {
  data: new SlashCommandBuilder().setName('upgrade').setDescription('See how KeepSeek Plus opens the KeepSeek Plus'),
  async execute(interaction: any) {
    const plan = getUserPlan(interaction.user.id);

    if (plan.tier === 'PRO' && plan.status === 'ACTIVE') {
      const lines = [
        'Your KeepSeek Plus is open and ready',
        '',
        `**Active Chases:** ${PLAN_LIMITS.PRO.maxActiveChases}`,
        `**Listing Checks:** every ${formatPollInterval(PLAN_LIMITS.PRO.pollIntervalSeconds)}`,
        '**Discovery:** deeper recommendations with taste profile memory'
      ];
      await interaction.reply({
        embeds: [successEmbed('You Are Pro', lines.join('\n')).setTitle('👑 You Are Pro')],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const lines = [
      'For collectors with more cards to watch, sharper preferences, and a personalized Display Case to browse',
      '',
      '**Your Free**',
      ...upgradeFreeVaultLines(),
      '',
      '**KeepSeek Plus**',
      ...upgradeFullVaultLines(),
      '',
      '**Status**',
      'Public checkout is not live yet. Pro access is currently available by request during beta'
    ];

    await interaction.reply({
      embeds: [infoEmbed('💎 Upgrade to KeepSeek Plus', lines.join('\n'))],
      flags: MessageFlags.Ephemeral
    });
  }
};
