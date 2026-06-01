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

export const chaseAdd = {
  data: new SlashCommandBuilder()
    .setName('chase-add')
    .setDescription('Add a card for Vaultr to watch')
    .addStringOption((opt) =>
      opt
        .setName('card')
        .setDescription('Card to chase, e.g. Umbreon VMAX 215/203')
        .setRequired(true)
        .setMinLength(3)
        .setMaxLength(100)
    )
    .addNumberOption((opt) => opt.setName('max_price').setDescription('Highest total price you want surfaced').setMinValue(0.01))
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
        .setDescription('Pro: minimum raw condition to surface')
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
        .setDescription('Pro: terms to keep out of this chase')
        .setMaxLength(240)
    )
    .addStringOption((opt) =>
      opt
        .setName('priority')
        .setDescription('Pro: how important this chase is')
        .addChoices(
          { name: 'Normal', value: 'NORMAL' },
          { name: 'High', value: 'HIGH' },
          { name: 'Grail', value: 'GRAIL' }
        )
    )
    .addStringOption((opt) =>
      opt.setName('target_note').setDescription('Pro: short note about what makes this one special').setMaxLength(120)
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
          : `Free Vaults can keep ${PLAN_LIMITS.FREE.maxActiveChases} active chases. Pro expands your Vault to ${PLAN_LIMITS.PRO.maxActiveChases} chases plus trusted shop monitoring. Remove one with /chase remove or run /upgrade.`;
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
    const usesPrecisionControls =
      (conditionRaw !== null && conditionRaw !== 'ANY') ||
      (listingTypeRaw !== null && listingTypeRaw !== 'ANY') ||
      (priorityRaw !== null && priorityRaw !== 'NORMAL') ||
      targetNote !== undefined ||
      hasCustomNegativeKeywords;

    if (usesPrecisionControls && !entitlements.advancedFiltering) {
      await interaction.reply({
        embeds: [
          warningEmbed(
            'Pro Feature',
            `Pro adds precision controls for serious chases.\n\n**Includes:** condition, listing type, custom blocked terms, priority, and chase notes\n**Also:** ${PLAN_LIMITS.PRO.maxActiveChases} active chases and trusted shop monitoring\n**Next:** use \`/upgrade\` to unlock`
          )
        ],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

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
      `**Condition:** ${displayCondition(chase.condition)}`,
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
