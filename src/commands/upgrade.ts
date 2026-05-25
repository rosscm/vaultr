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
        `**Plan:** ${plan.tier} (${plan.status})`,
        `**Active Chases:** ${PLAN_LIMITS.PRO.maxActiveChases}`,
        `**Checks for New Listings:** Every ${formatPollInterval(PLAN_LIMITS.PRO.pollIntervalSeconds)}`
      ];
      await interaction.reply({
        embeds: [successEmbed('You Are Pro', lines.join('\n')).setTitle('👑 You Are Pro')],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const lines = [
      'Pro gives your Vault more room, quicker sightings, and finer control over each chase.',
      '',
      `**Active Chases:** ${PLAN_LIMITS.FREE.maxActiveChases} → ${PLAN_LIMITS.PRO.maxActiveChases}`,
      `**Checks for New Listings:** ${formatPollInterval(PLAN_LIMITS.FREE.pollIntervalSeconds)} → ${formatPollInterval(PLAN_LIMITS.PRO.pollIntervalSeconds)}`,
      '**Signal Controls:** add quiet hours, compact DMs, and image display controls',
      '**Discovery:** richer recommendations as your Vault grows',
      '**Precision Filters:** condition, listing type, custom blocked terms, priority, and chase notes',
      '**How to Upgrade:** Upgrade path coming soon.'
    ];

    await interaction.reply({
      embeds: [infoEmbed('💎 Upgrade to Vaultr Pro', lines.join('\n'))],
      flags: MessageFlags.Ephemeral
    });
  }
};
