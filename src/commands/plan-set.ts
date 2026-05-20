import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { setUserPlan } from '../services/chase-store.js';
import { normalizePlanTier } from '../services/plans.js';
import { keyValue, successEmbed } from '../ui/embeds.js';
import { formatLocalDateTime } from '../ui/time.js';

export const planSet = {
  data: new SlashCommandBuilder()
    .setName('plan-set')
    .setDescription('Admin: set a user plan tier for testing')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption((opt) => opt.setName('user').setDescription('Target user').setRequired(true))
    .addStringOption((opt) =>
      opt
        .setName('tier')
        .setDescription('Plan tier')
        .setRequired(true)
        .addChoices(
          { name: 'FREE', value: 'FREE' },
          { name: 'PRO', value: 'PRO' }
        )
    )
    .addStringOption((opt) =>
      opt
        .setName('status')
        .setDescription('Billing status')
        .addChoices(
          { name: 'ACTIVE', value: 'ACTIVE' },
          { name: 'PAST_DUE', value: 'PAST_DUE' },
          { name: 'CANCELED', value: 'CANCELED' }
        )
    ),
  async execute(interaction: any) {
    const user = interaction.options.getUser('user', true);
    const tier = normalizePlanTier(interaction.options.getString('tier', true));
    const status = (interaction.options.getString('status') as 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | null) ?? 'ACTIVE';

    const updated = setUserPlan(user.id, tier, status);

    await interaction.reply({
      embeds: [
        successEmbed('Plan Updated').addFields(
          keyValue('User', `<@${user.id}>`),
          keyValue('Tier', updated.tier),
          keyValue('Status', updated.status),
          keyValue('Updated', formatLocalDateTime(updated.updatedAt))
        )
      ],
      flags: MessageFlags.Ephemeral
    });
  }
};
