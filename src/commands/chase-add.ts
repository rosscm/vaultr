import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { addChase, countUserChases, getUserPlan, getGuildCommandChannel, isGuildCommunityFeedEnabled } from '../services/chase-store.js';
import { PLAN_LIMITS } from '../services/plans.js';
import { keyValue, successEmbed, warningEmbed } from '../ui/embeds.js';

const DEFAULT_NEGATIVE_KEYWORDS = ['proxy', 'custom', 'reprint', 'lot', 'orica', 'replica'];

export const chaseAdd = {
  data: new SlashCommandBuilder()
    .setName('chase-add')
    .setDescription('Add a new chase card')
    .addStringOption((opt) => opt.setName('card').setDescription('Card name').setRequired(true))
    .addNumberOption((opt) => opt.setName('max_price').setDescription('Max price'))
    .addStringOption((opt) => opt.setName('grade').setDescription('Grade preference (e.g. PSA 10)'))
    .addStringOption((opt) =>
      opt
        .setName('condition')
        .setDescription('Condition preference')
        .addChoices(
          { name: 'Near Mint', value: 'NM' },
          { name: 'Lightly Played', value: 'LP' },
          { name: 'Moderately Played', value: 'MP' },
          { name: 'Heavily Played', value: 'HP' },
          { name: 'Damaged', value: 'DMG' }
        )
    )
    .addStringOption((opt) =>
      opt
        .setName('region')
        .setDescription('Seller region')
        .addChoices(
          { name: 'Any', value: 'ANY' },
          { name: 'Canada', value: 'CA' },
          { name: 'United States', value: 'US' }
        )
    )
    .addStringOption((opt) =>
      opt
        .setName('negative_keywords')
        .setDescription('Comma-separated blocked terms (e.g. proxy,custom,reprint)')
    ),
  async execute(interaction: any) {
    const plan = getUserPlan(interaction.user.id);
    const currentCount = countUserChases(interaction.user.id);
    const maxChases = PLAN_LIMITS[plan.tier].maxActiveChases;

    if (currentCount >= maxChases) {
      await interaction.reply({
        embeds: [
          warningEmbed(
            'Plan Limit Reached',
            `You have reached your ${plan.tier} limit of ${maxChases} active chases. Remove one with /chase-remove or run /upgrade.`
          )
        ],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const cardName = interaction.options.getString('card', true);
    const maxPrice = interaction.options.getNumber('max_price') ?? undefined;
    const grade = interaction.options.getString('grade') ?? undefined;
    const condition = interaction.options.getString('condition') ?? undefined;
    const region = (interaction.options.getString('region') as 'CA' | 'US' | 'ANY' | null) ?? 'ANY';
    const negativeKeywords = interaction.options
      .getString('negative_keywords')
      ?.split(',')
      .map((k) => k.trim())
      .filter(Boolean);

    const chase = addChase({
      userId: interaction.user.id,
      guildId: interaction.guildId ?? undefined,
      cardName,
      maxPrice,
      grade,
      condition,
      region,
      negativeKeywords: negativeKeywords && negativeKeywords.length > 0 ? negativeKeywords : DEFAULT_NEGATIVE_KEYWORDS
    });

    await interaction.reply({
      embeds: [
        successEmbed('Chase Added')
          .addFields(
            keyValue('Card', chase.cardName),
            keyValue('Max Price', `${chase.maxPrice ?? 'any'}`),
            keyValue('Grade', chase.grade ?? 'any'),
            keyValue('Condition', chase.condition ?? 'any'),
            keyValue('Region', chase.region ?? 'ANY'),
            keyValue('Blocked Terms', chase.negativeKeywords?.join(', ') ?? 'none')
          )
      ],
      flags: MessageFlags.Ephemeral
    });

    // Optional community heartbeat message (anonymized) to keep channel active without leaking chase details.
    if (interaction.guildId && isGuildCommunityFeedEnabled(interaction.guildId)) {
      const channelId = getGuildCommandChannel(interaction.guildId);
      const channel = channelId ? await interaction.client.channels.fetch(channelId).catch(() => null) : null;
      if (channel && 'send' in channel) {
        await channel.send('🔎 A collector started a new chase.');
      }
    }
  }
};
