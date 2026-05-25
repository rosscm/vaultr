import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { getUserPlan } from '../services/chase-store.js';
import { formatPollCadence, PLAN_LIMITS } from '../services/plans.js';
import { infoEmbed, successEmbed } from '../ui/embeds.js';

export const upgrade = {
  data: new SlashCommandBuilder().setName('upgrade').setDescription('See how Vaultr Pro deepens your Vault'),
  async execute(interaction: any) {
    const plan = getUserPlan(interaction.user.id);

    if (plan.tier === 'PRO' && plan.status === 'ACTIVE') {
      const lines = [
        `**Plan:** ${plan.tier} (${plan.status})`,
        `**Active Chases:** ${PLAN_LIMITS.PRO.maxActiveChases}`,
        `**Sighting Cadence:** Every ${formatPollCadence(PLAN_LIMITS.PRO.pollIntervalSeconds)}`
      ];
      await interaction.reply({
        embeds: [successEmbed('You Are Pro', lines.join('\n')).setTitle('👑 You Are Pro')],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const lines = [
      '**Pro Upgrades**',
      `**Active Chases:** ${PLAN_LIMITS.FREE.maxActiveChases} → ${PLAN_LIMITS.PRO.maxActiveChases}`,
      `**Sighting Cadence:** ${formatPollCadence(PLAN_LIMITS.FREE.pollIntervalSeconds)} → ${formatPollCadence(PLAN_LIMITS.PRO.pollIntervalSeconds)}`,
      '**Signal Controls:** add quiet hours, compact DMs, and image display controls',
      '**Discovery:** richer recommendation cadence as your Vault grows',
      '**Precision Filters:** condition, listing type, custom blocked terms, priority, and chase notes',
      '**How to Upgrade:** Upgrade path coming soon.'
    ];

    await interaction.reply({
      embeds: [infoEmbed('💎 Upgrade to Vaultr Pro', lines.join('\n'))],
      flags: MessageFlags.Ephemeral
    });
  }
};
