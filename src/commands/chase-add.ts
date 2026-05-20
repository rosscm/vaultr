import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { addChase, countUserChases, getUserPlan, getGuildCommandChannel, isGuildCommunityFeedEnabled } from '../services/chase-store.js';
import { PLAN_LIMITS } from '../services/plans.js';
import { keyValue, successEmbed, warningEmbed } from '../ui/embeds.js';

const DEFAULT_NEGATIVE_KEYWORDS = ['proxy', 'custom', 'reprint', 'lot', 'orica', 'replica'];

export const chaseAdd = {
  data: new SlashCommandBuilder()
    .setName('chase-add')
    .setDescription('Add a new chase card')
    .addStringOption((opt) =>
      opt
        .setName('card')
        .setDescription('Card name (3-100 chars, casing ignored)')
        .setRequired(true)
        .setMinLength(3)
        .setMaxLength(100)
    )
    .addNumberOption((opt) => opt.setName('max_price').setDescription('Max price (must be > 0)').setMinValue(0.01))
    .addStringOption((opt) => opt.setName('grade').setDescription('Grade preference, e.g. PSA 10').setMaxLength(24))
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
        .setName('listing_type')
        .setDescription('Listing type')
        .addChoices(
          { name: 'Any', value: 'ANY' },
          { name: 'Auction', value: 'AUCTION' },
          { name: 'Buy It Now', value: 'BUY_IT_NOW' }
        )
    )
    .addStringOption((opt) =>
      opt
        .setName('negative_keywords')
        .setDescription('Blocked terms CSV (max 15), e.g. proxy,custom,reprint')
        .setMaxLength(240)
    )
    .addStringOption((opt) =>
      opt
        .setName('priority')
        .setDescription('Priority for this chase')
        .addChoices(
          { name: 'Normal', value: 'NORMAL' },
          { name: 'High', value: 'HIGH' },
          { name: 'Grail', value: 'GRAIL' }
        )
    )
    .addStringOption((opt) =>
      opt.setName('target_note').setDescription('Personal note (why this matters to you)').setMaxLength(120)
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
    const listingType = (interaction.options.getString('listing_type') as 'ANY' | 'AUCTION' | 'BUY_IT_NOW' | null) ?? 'ANY';
    const priority = (interaction.options.getString('priority') as 'GRAIL' | 'HIGH' | 'NORMAL' | null) ?? 'NORMAL';
    const targetNote = interaction.options.getString('target_note') ?? undefined;
    const negativeKeywords = interaction.options
      .getString('negative_keywords')
      ?.split(',')
      .map((k: string) => k.trim())
      .filter(Boolean);

    if (negativeKeywords && negativeKeywords.length > 15) {
      await interaction.reply({
        embeds: [warningEmbed('Too Many Blocked Terms', 'Use at most 15 comma-separated blocked terms.')],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const chase = addChase({
      userId: interaction.user.id,
      guildId: interaction.guildId ?? undefined,
      cardName,
      priority,
      targetNote,
      maxPrice,
      grade,
      condition,
      region,
      listingType,
      negativeKeywords: negativeKeywords && negativeKeywords.length > 0 ? negativeKeywords : DEFAULT_NEGATIVE_KEYWORDS
    });

    await interaction.reply({
      embeds: [
        successEmbed('Chase Added')
          .addFields(
            keyValue('Card', chase.cardName),
            keyValue('Priority', chase.priority ?? 'NORMAL'),
            keyValue('Max Price', `${chase.maxPrice ?? 'any'}`),
            keyValue('Grade', chase.grade ?? 'any'),
            keyValue('Condition', chase.condition ?? 'any'),
            keyValue('Region', chase.region ?? 'ANY'),
            keyValue('Listing Type', chase.listingType ?? 'ANY'),
            keyValue('Blocked Terms', chase.negativeKeywords?.join(', ') ?? 'none'),
            keyValue('Note', chase.targetNote ?? 'none')
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
