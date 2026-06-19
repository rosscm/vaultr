import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { getUserPlan } from '../services/chase-store.js';
import { activePlanTier, formatActivePlanAccess, formatPollInterval, PLAN_LIMITS } from '../services/plans.js';
import { infoEmbed, warningEmbed } from '../ui/embeds.js';
import { formatLocalDateTime } from '../ui/time.js';
import { executePlanSet } from './plan-set.js';

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
  const freeChaseLimit = PLAN_LIMITS.FREE.maxActiveChases;
  const proChaseLimit = PLAN_LIMITS.PRO.maxActiveChases;
  const freePollInterval = formatPollInterval(PLAN_LIMITS.FREE.pollIntervalSeconds);
  const proPollInterval = formatPollInterval(PLAN_LIMITS.PRO.pollIntervalSeconds);
  const accessSummary = activeTier === 'PRO'
    ? `Full Vault is active: ${proChaseLimit} active chases, faster checks, trusted shops, precision controls, and a richer Weekly Shelf that learns from taste profile memory`
    : `Free Vault is active: ${freeChaseLimit} active chases, DM alerts, and a starter Weekly Shelf preview`;
  const embed = infoEmbed(title, accessSummary);
  embed.addFields(
    {
      name: 'Current Access',
      value: activeAccessLine === 'Pro' || activeAccessLine === 'Free'
        ? `**Plan:** ${vaultName}`
        : [`**Plan:** ${vaultName}`, `**Status:** ${activeAccessLine}`].join('\n'),
      inline: false
    },
    {
      name: 'Included',
      value: activeTier === 'PRO'
        ? [
            `- ${proChaseLimit} active chases with checks every ${proPollInterval}`,
            '- trusted shops alongside eBay for shop-only restock signals',
            '- precision controls for conditions, listing types, custom exclusions, priority, and notes',
            '- richer Weekly Shelf recommendations powered by taste profile memory'
          ].join('\n')
        : [
            `- ${freeChaseLimit} active chases with eBay checks every ${freePollInterval}`,
            '- DM alerts with core tuning controls',
            '- starter Weekly Shelf preview based on active chases'
          ].join('\n'),
      inline: false
    }
  );

  if (activeTier === 'FREE') {
    embed.addFields({
      name: 'Pro Features',
      value: [
        `- ${proChaseLimit} active chases with checks every ${proPollInterval}`,
        '- trusted shops alongside eBay for shop-only restock signals',
        '- precision controls for conditions, listing types, custom exclusions, priority, and notes',
        '- a deeper Weekly Shelf that learns from taste profile memory',
        '- use `/upgrade` to open your Full Vault'
      ].join('\n'),
      inline: false
    });
  }

  embed.addFields({
    name: 'Updated',
    value: formatLocalDateTime(userPlan.updatedAt),
    inline: false
  });

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
        .setDescription('Update member Vault access')
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
      const ownerId = process.env.OWNER_USER_ID;
      if (!ownerId || interaction.user.id !== ownerId) {
        await interaction.reply({
          embeds: [warningEmbed('Owner Only', 'This subcommand is reserved for the Vaultr owner')],
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
