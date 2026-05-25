import { MessageFlags } from 'discord.js';
import { setUserPlan } from '../services/chase-store.js';
import { normalizePlanTier } from '../services/plans.js';
import { successEmbed } from '../ui/embeds.js';
import { formatLocalDateTime } from '../ui/time.js';

export async function executePlanSet(interaction: any): Promise<void> {
  const user = interaction.options.getUser('user', true);
  const tier = normalizePlanTier(interaction.options.getString('tier', true));
  const status = (interaction.options.getString('status') as 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | null) ?? 'ACTIVE';

  const updated = setUserPlan(user.id, tier, status);
  const lines = [
    `**User:** <@${user.id}>`,
    `**Tier:** ${updated.tier}`,
    `**Status:** ${updated.status}`,
    `**Updated:** ${formatLocalDateTime(updated.updatedAt)}`
  ];

  await interaction.reply({
    embeds: [successEmbed('Plan Updated', lines.join('\n')).setTitle('✅ Plan Updated')],
    flags: MessageFlags.Ephemeral
  });
}
