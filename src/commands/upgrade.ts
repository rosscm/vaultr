import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { getUserPlan } from '../services/chase-store.js';
import { formatPollInterval, PLAN_LIMITS } from '../services/plans.js';
import { infoEmbed, successEmbed } from '../ui/embeds.js';
import { upgradeFreeVaultLines, upgradeFullVaultLines } from './pro-copy.js';

export const upgrade = {
  data: new SlashCommandBuilder().setName('upgrade').setDescription('See how Vaultr Pro opens the Full Vault'),
  async execute(interaction: any) {
    const plan = getUserPlan(interaction.user.id);

    if (plan.tier === 'PRO' && plan.status === 'ACTIVE') {
      const lines = [
        'Your Full Vault is open and ready',
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
      'For collectors with more grails to track, sharper preferences, and a deeper Weekly Shelf to browse',
      '',
      '**Your Free Vault**',
      ...upgradeFreeVaultLines(),
      '',
      '**Full Vault**',
      ...upgradeFullVaultLines(),
      '',
      '**Status**',
      'Checkout is coming soon. Pro access is currently available by request'
    ];

    await interaction.reply({
      embeds: [infoEmbed('💎 Upgrade to Vaultr Pro', lines.join('\n'))],
      flags: MessageFlags.Ephemeral
    });
  }
};
