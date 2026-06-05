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
import { activePlanTier, PLAN_LIMITS } from '../services/plans.js';
import { successEmbed, warningEmbed } from '../ui/embeds.js';
import { OUTPUT_STYLE, displayCondition, displayGrade, orNone } from '../ui/style.js';
import { buildGradePreference, CONDITION_CHOICES, GRADE_VALUE_CHOICES, GRADING_TYPE_CHOICES, gradeSelectionWarning, normalizeConditionChoice } from './chase-options.js';

const DEFAULT_NEGATIVE_KEYWORDS = ['proxy', 'custom', 'reprint', 'lot', 'orica', 'replica'];

function displayAny(value: string | undefined): string {
  if (!value || value === 'ANY') return OUTPUT_STYLE.any;
  return value;
}

function proControlNames(values: {
  conditionRaw: string | null;
  listingTypeRaw: string | null;
  priorityRaw: string | null;
  targetNote: string | undefined;
  hasCustomNegativeKeywords: boolean;
}): string[] {
  return [
    values.conditionRaw !== null && values.conditionRaw !== 'ANY' ? 'condition' : undefined,
    values.listingTypeRaw !== null && values.listingTypeRaw !== 'ANY' ? 'listing type' : undefined,
    values.priorityRaw !== null && values.priorityRaw !== 'NORMAL' ? 'priority' : undefined,
    values.targetNote !== undefined ? 'note' : undefined,
    values.hasCustomNegativeKeywords ? 'blocked terms' : undefined
  ].filter((value): value is string => Boolean(value));
}

export const chaseAdd = {
  data: new SlashCommandBuilder()
    .setName('chase-add')
    .setDescription('Add a card to your Vault')
    .addStringOption((opt) =>
      opt
        .setName('card')
        .setDescription('Card name or number, e.g. Umbreon VMAX 215/203')
        .setRequired(true)
        .setMinLength(3)
        .setMaxLength(100)
    )
    .addNumberOption((opt) => opt.setName('max_price').setDescription('Highest total price to surface').setMinValue(0.01))
    .addStringOption((opt) =>
      opt
        .setName('grading_type')
        .setDescription('Slab/raw preference (default: Any)')
        .addChoices(...GRADING_TYPE_CHOICES)
    )
    .addStringOption((opt) =>
      opt
        .setName('grade_value')
        .setDescription('Numeric grade preference (default: Any)')
        .addChoices(...GRADE_VALUE_CHOICES)
    )
    .addStringOption((opt) =>
      opt
        .setName('condition')
        .setDescription('Pro: minimum raw condition')
        .addChoices(...CONDITION_CHOICES)
    )
    .addStringOption((opt) =>
      opt
        .setName('listing_type')
        .setDescription('Pro: auction or Buy It Now preference')
        .addChoices(
          { name: 'Any', value: 'ANY' },
          { name: 'Auction', value: 'AUCTION' },
          { name: 'Buy It Now', value: 'BUY_IT_NOW' }
        )
    )
    .addStringOption((opt) =>
      opt
        .setName('negative_keywords')
        .setDescription('Pro: terms to block from this chase')
        .setMaxLength(240)
    )
    .addStringOption((opt) =>
      opt
        .setName('priority')
        .setDescription('Pro: chase importance')
        .addChoices(
          { name: 'Normal', value: 'NORMAL' },
          { name: 'High', value: 'HIGH' },
          { name: 'Grail', value: 'GRAIL' }
        )
    )
    .addStringOption((opt) =>
      opt.setName('target_note').setDescription('Pro: short note for this chase').setMaxLength(120)
    ),
  async execute(interaction: any) {
    const plan = getUserPlan(interaction.user.id);
    const activeTier = activePlanTier(plan);
    const entitlements = getEntitlementsForTier(activeTier);
    const currentCount = countUserChases(interaction.user.id);
    const maxChases = PLAN_LIMITS[activeTier].maxActiveChases;

    if (currentCount >= maxChases) {
      const message =
        activeTier === 'PRO'
          ? `You have reached your Pro limit of ${maxChases} active chases. Remove one with /chase remove before adding another.`
          : `Free Vaults can keep ${PLAN_LIMITS.FREE.maxActiveChases} active chases. Pro expands your Vault to ${PLAN_LIMITS.PRO.maxActiveChases} active chases, faster checks, deeper Discovery, and trusted shop sources. Remove one with /chase remove or run /upgrade.`;
      await interaction.reply({
        embeds: [warningEmbed('Vault Limit Reached', message)],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const cardName = interaction.options.getString('card', true);
    const maxPrice = interaction.options.getNumber('max_price') ?? undefined;
    const gradingType = interaction.options.getString('grading_type') as Parameters<typeof buildGradePreference>[0];
    const gradeValue = interaction.options.getString('grade_value') as Parameters<typeof buildGradePreference>[1];
    const gradeWarning = gradeSelectionWarning(gradingType, gradeValue);
    if (gradeWarning) {
      await interaction.reply({
        embeds: [warningEmbed('Invalid Grade Preference', gradeWarning)],
        flags: MessageFlags.Ephemeral
      });
      return;
    }
    const grade = buildGradePreference(gradingType, gradeValue) ?? undefined;
    const conditionRaw = interaction.options.getString('condition') as Parameters<typeof normalizeConditionChoice>[0];
    const condition = normalizeConditionChoice(conditionRaw) ?? undefined;
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
    const blockedProControls = entitlements.advancedFiltering
      ? []
      : proControlNames({ conditionRaw, listingTypeRaw, priorityRaw, targetNote, hasCustomNegativeKeywords });
    const canUsePrecisionControls = entitlements.advancedFiltering;
    const appliedCondition = canUsePrecisionControls ? condition : undefined;
    const listingType = canUsePrecisionControls ? listingTypeRaw ?? 'ANY' : 'ANY';
    const priority = canUsePrecisionControls ? priorityRaw ?? 'NORMAL' : 'NORMAL';
    const appliedTargetNote = canUsePrecisionControls ? targetNote : undefined;
    const negativeKeywords = canUsePrecisionControls
      ? negativeKeywordsRaw
          ?.split(',')
          .map((k: string) => k.trim())
          .filter(Boolean)
      : undefined;

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
      targetNote: appliedTargetNote,
      maxPrice,
      grade,
      condition: appliedCondition,
      listingType,
      negativeKeywords: negativeKeywords && negativeKeywords.length > 0 ? negativeKeywords : DEFAULT_NEGATIVE_KEYWORDS
    });

    const lines = [
      'Nice pick. Vaultr is watching this chase now.',
      '',
      `**Card:** ${chase.cardName}`,
      `**Priority:** ${chase.priority ?? 'NORMAL'}`,
      `**Note:** ${orNone(chase.targetNote)}`,
      `**Max Price:** ${chase.maxPrice ?? OUTPUT_STYLE.any}`,
      `**Grade:** ${displayGrade(chase.grade)}`,
      `**Condition:** ${displayCondition(chase.condition)}`,
      `**Listing Type:** ${displayAny(chase.listingType)}`,
      `**Blocked Terms:** ${chase.negativeKeywords?.join(', ') ?? OUTPUT_STYLE.none}`,
      ...(blockedProControls.length > 0
        ? [
            '',
            `**Pro Controls Not Applied:** ${blockedProControls.join(', ')}`,
            `**Next:** use \`/upgrade\` to unlock ${PLAN_LIMITS.PRO.maxActiveChases} active chases and precision controls`
          ]
        : []),
      '',
      '**Next:** Use `/chase list` to admire the lineup'
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
            `🏁✨ **${displayName}** started their **Vault** with their first chase`
          );
        }
      }
    }
  }
};
