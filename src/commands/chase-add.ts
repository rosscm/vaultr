import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import {
  addChase,
  countUserChases,
  getGuildCommunityFeedMode,
  getUserPlan,
  getGuildCommandChannel,
  markGuildUserStarted
} from '../services/chase-store.js';
import { getEntitlementsForTier } from '../services/entitlements.js';
import { PLAN_LIMITS } from '../services/plans.js';
import { successEmbed, warningEmbed } from '../ui/embeds.js';
import { OUTPUT_STYLE, displayGrade, normalizeGradePreference, orAny, orNone } from '../ui/style.js';

const DEFAULT_NEGATIVE_KEYWORDS = ['proxy', 'custom', 'reprint', 'lot', 'orica', 'replica'];
const ALLOWED_CONDITIONS = new Set(['NM', 'LP', 'MP', 'HP', 'DMG']);

function displayAny(value: string | undefined): string {
  if (!value || value === 'ANY') return OUTPUT_STYLE.any;
  return value;
}

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
    .addStringOption((opt) => opt.setName('grade').setDescription('Grade preference, e.g. PSA 10 or ungraded/raw (default: Any)').setMaxLength(24))
    .addStringOption((opt) =>
      opt
        .setName('condition')
        .setDescription('Pro: condition(s): NM,LP,MP,HP,DMG (default: Any)')
        .setMaxLength(40)
    )
    .addStringOption((opt) =>
      opt
        .setName('listing_type')
        .setDescription('Pro: listing type (default: Any)')
        .addChoices(
          { name: 'Any', value: 'ANY' },
          { name: 'Auction', value: 'AUCTION' },
          { name: 'Buy It Now', value: 'BUY_IT_NOW' }
        )
    )
    .addStringOption((opt) =>
      opt
        .setName('negative_keywords')
        .setDescription('Pro: custom blocked terms (comma-separated, max 15)')
        .setMaxLength(240)
    )
    .addStringOption((opt) =>
      opt
        .setName('priority')
        .setDescription('Pro: priority for this chase (default: Normal)')
        .addChoices(
          { name: 'Normal', value: 'NORMAL' },
          { name: 'High', value: 'HIGH' },
          { name: 'Grail', value: 'GRAIL' }
        )
    )
    .addStringOption((opt) =>
      opt.setName('target_note').setDescription('Pro: optional chase note').setMaxLength(120)
    ),
  async execute(interaction: any) {
    const plan = getUserPlan(interaction.user.id);
    const entitlements = getEntitlementsForTier(plan.tier);
    const currentCount = countUserChases(interaction.user.id);
    const maxChases = PLAN_LIMITS[plan.tier].maxActiveChases;

    if (currentCount >= maxChases) {
      await interaction.reply({
        embeds: [
          warningEmbed(
            'Plan Limit Reached',
            `You have reached your ${plan.tier} limit of ${maxChases} active chases. Remove one with /chase remove or run /upgrade.`
          )
        ],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const cardName = interaction.options.getString('card', true);
    const maxPrice = interaction.options.getNumber('max_price') ?? undefined;
    const grade = normalizeGradePreference(interaction.options.getString('grade'));
    const conditionRaw = interaction.options.getString('condition');
    const listingTypeRaw = interaction.options.getString('listing_type') as 'ANY' | 'AUCTION' | 'BUY_IT_NOW' | null;
    const priorityRaw = interaction.options.getString('priority') as 'GRAIL' | 'HIGH' | 'NORMAL' | null;
    const targetNote = interaction.options.getString('target_note') ?? undefined;
    const negativeKeywordsRaw = interaction.options.getString('negative_keywords');
    const hasCustomNegativeKeywords =
      negativeKeywordsRaw !== null &&
      negativeKeywordsRaw
        .split(',')
        .map((k: string) => k.trim())
        .filter(Boolean).length > 0;
    const usesPrecisionControls =
      conditionRaw !== null ||
      (listingTypeRaw !== null && listingTypeRaw !== 'ANY') ||
      (priorityRaw !== null && priorityRaw !== 'NORMAL') ||
      targetNote !== undefined ||
      hasCustomNegativeKeywords;

    if (usesPrecisionControls && !entitlements.advancedFiltering) {
      await interaction.reply({
        embeds: [
          warningEmbed(
            'Pro Feature',
            'Precision chase controls are available on Pro\n\n**Includes:** condition, listing type, custom blocked terms, priority, and chase notes\n**Next:** use `/upgrade` to unlock'
          )
        ],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const conditionTokens = conditionRaw
      ?.split(',')
      .map((v: string) => v.trim().toUpperCase())
      .filter(Boolean);
    if (conditionTokens && !conditionTokens.every((v: string) => ALLOWED_CONDITIONS.has(v))) {
      await interaction.reply({
        embeds: [warningEmbed('Invalid Condition', 'Use only: NM, LP, MP, HP, DMG (comma-separated allowed).')],
        flags: MessageFlags.Ephemeral
      });
      return;
    }
    const condition = conditionTokens && conditionTokens.length > 0 ? conditionTokens.join(',') : undefined;
    const listingType = listingTypeRaw ?? 'ANY';
    const priority = priorityRaw ?? 'NORMAL';
    const negativeKeywords = negativeKeywordsRaw
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
      listingType,
      negativeKeywords: negativeKeywords && negativeKeywords.length > 0 ? negativeKeywords : DEFAULT_NEGATIVE_KEYWORDS
    });

    const lines = [
      `**Card:** ${chase.cardName}`,
      `**Priority:** ${chase.priority ?? 'NORMAL'}`,
      `**Note:** ${orNone(chase.targetNote)}`,
      `**Max Price:** ${chase.maxPrice ?? OUTPUT_STYLE.any}`,
      `**Grade:** ${displayGrade(chase.grade)}`,
      `**Condition:** ${orAny(chase.condition)}`,
      `**Listing Type:** ${displayAny(chase.listingType)}`,
      `**Blocked Terms:** ${chase.negativeKeywords?.join(', ') ?? OUTPUT_STYLE.none}`,
      '',
      '**Next:** Use `/chase list` to review your vault entries'
    ];

    await interaction.reply({
      embeds: [successEmbed('Chase Added', lines.join('\n')).setTitle('✅ Chase Added')],
      flags: MessageFlags.Ephemeral
    });

    // Optional community message: only once per user per guild.
    if (interaction.guildId && getGuildCommunityFeedMode(interaction.guildId) !== 'OFF' && currentCount === 0) {
      const isFirstGuildAnnouncement = markGuildUserStarted(interaction.guildId, interaction.user.id);
      if (isFirstGuildAnnouncement) {
        const channelId = getGuildCommandChannel(interaction.guildId);
        const channel = channelId ? await interaction.client.channels.fetch(channelId).catch(() => null) : null;
        if (channel && 'send' in channel) {
          const displayName = interaction.member?.nickname ?? interaction.user.globalName ?? interaction.user.username;
          await channel.send(
            `🗝️✨ **${displayName}** just unlocked their **Vault** with their first chase`
          );
        }
      }
    }
  }
};
