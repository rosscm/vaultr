import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { getUserPlan } from '../services/chase-store.js';
import { activePlanTier, formatActivePlanAccess } from '../services/plans.js';
import { infoEmbed, warningEmbed } from '../ui/embeds.js';
import { formatLocalDateTime } from '../ui/time.js';
import { executePlanSet } from './plan-set.js';
import { fullVaultLines } from './pro-copy.js';

function displayPlanAccess(userPlan: ReturnType<typeof getUserPlan>): string {
  const access = formatActivePlanAccess(userPlan);
  if (access === 'FREE') return 'Free';
  if (access === 'PRO') return 'Pro';
  return access.replaceAll('FREE', 'Free').replaceAll('PRO', 'Pro');
}

export function buildPlanViewPayload(userId: string, title = '🧾 Vaultr Plan') {
  const userPlan = getUserPlan(userId);
  const activeTier = activePlanTier(userPlan);
  const activeAccessLine = displayPlanAccess(userPlan);
  const vaultName = activeTier === 'PRO' ? 'Full Vault' : 'Free Vault';
  const accessSummary = activeTier === 'PRO'
    ? 'Full Vault is active: deeper Weekly Shelf recommendations, Taste Profile memory, trusted shops, and precision controls'
    : 'Free Vault is live: core chase tracking and Weekly Discovery previews';
  const embed = infoEmbed(title, accessSummary);
  embed.addFields(
    {
      name: 'Current Vault',
      value: [`**Vault:** ${vaultName}`, `**Access:** ${activeAccessLine}`].join('\n'),
      inline: false
    },
    {
      name: 'Plan Role',
      value: activeTier === 'PRO' ? 'Unlocks the full collector surface across alerts, trusted shops, precision controls, and Weekly Shelf depth' : 'Covers the starter collector surface; alert settings hold the watch controls',
      inline: false
    },
    {
      name: 'Updated',
      value: formatLocalDateTime(userPlan.updatedAt),
      inline: false
    }
  );

  if (activeTier === 'FREE') {
    embed.addFields({
      name: 'Full Vault',
      value: fullVaultLines().join('\n'),
      inline: false
    });
  }

  return {
    embeds: [embed],
    components: [],
    flags: MessageFlags.Ephemeral
  };
}

export const plan = {
  data: new SlashCommandBuilder()
    .setName('plan')
    .setDescription('View your Vaultr plan')
    .addSubcommand((sub) => sub.setName('view').setDescription('View your current Vaultr plan'))
    .addSubcommand((sub) =>
      sub
        .setName('set')
        .setDescription('Admin: update a user plan')
        .addUserOption((opt) => opt.setName('user').setDescription('Member to update').setRequired(true))
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
            .setDescription('Plan status')
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

    await interaction.reply(buildPlanViewPayload(interaction.user.id));
  }
};
