import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { getUserPlan } from '../services/chase-store.js';
import { formatPollCadence, PLAN_LIMITS } from '../services/plans.js';
import { infoEmbed, warningEmbed } from '../ui/embeds.js';
import { formatLocalDateTime } from '../ui/time.js';
import { executePlanSet } from './plan-set.js';

export const plan = {
  data: new SlashCommandBuilder()
    .setName('plan')
    .setDescription('View your Vaultr plan or manage plan testing')
    .addSubcommand((sub) => sub.setName('view').setDescription('Show your Vaultr plan and limits'))
    .addSubcommand((sub) =>
      sub
        .setName('set')
        .setDescription('Admin: set a user plan tier for testing')
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
        )
    ),
  async execute(interaction: any) {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === 'set') {
      if (!interaction.guildId || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        await interaction.reply({
          embeds: [warningEmbed('Admin Only', 'This subcommand requires Manage Server permissions in a server')],
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      await executePlanSet(interaction);
      return;
    }

    const userPlan = getUserPlan(interaction.user.id);
    const limits = PLAN_LIMITS[userPlan.tier];
    const lines = [
      `**Tier:** ${userPlan.tier}`,
      `**Status:** ${userPlan.status}`,
      `**Active Chase Limit:** ${limits.maxActiveChases}`,
      `**Sighting Cadence:** Every ${formatPollCadence(limits.pollIntervalSeconds)}`,
      `**Updated:** ${formatLocalDateTime(userPlan.updatedAt)}`
    ];

    await interaction.reply({
      embeds: [infoEmbed('🧾 Your Vaultr Plan', lines.join('\n'))],
      flags: MessageFlags.Ephemeral
    });
  }
};
