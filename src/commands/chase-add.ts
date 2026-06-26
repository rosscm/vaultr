import { MessageFlags } from 'discord.js';
import {
  addChase,
  countUserChases,
  getGuildCommunityFeedMode,
  getUserPlan,
  getGuildCommandChannel,
  listChases,
  markGuildUserStarted
} from '../services/chase-store.js';
import { getEntitlementsForTier } from '../services/entitlements.js';
import { activePlanTier, PLAN_LIMITS } from '../services/plans.js';
import { autocompleteChaseCards, getCachedChaseCardPreviewImage } from '../services/chase-card-catalog.js';
import { successEmbed, warningEmbed } from '../ui/embeds.js';
import { OUTPUT_STYLE, displayCondition, displayGrade, orNone } from '../ui/style.js';
import { buildGradePreference, gradeSelectionWarning, normalizeConditionChoice } from './chase-options.js';
import { freeVaultLimitMessage, proControlsNextLine } from './pro-copy.js';

const DEFAULT_NEGATIVE_KEYWORDS = ['proxy', 'custom', 'reprint', 'lot', 'orica', 'replica', 'fan art', 'novelty', 'keychain', 'extended art', 'acrylic case', 'magnetic case'];

function normalizeChaseName(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function displayAny(value: string | undefined): string {
  if (!value || value === 'ANY') return OUTPUT_STYLE.any;
  return value;
}

function chaseNameQualityLine(cardName: string): string {
  const tokens = cardName.trim().split(/\s+/).filter(Boolean);
  const hasNumber = /\b\d{1,4}\s*[/#-]\s*\d{1,4}\b|\b[A-Z]{1,4}\d{1,4}\b/i.test(cardName);
  const hasSetSignal = /\b(promo|fates|festival|paldean|evolving|skyridge|unleashed|base|rocket|japanese|korean|english|psa|bgs|cgc|sar|sir|alt|ex|vmax)\b/i.test(cardName);

  if (hasNumber && tokens.length >= 2) return 'Plenty of detail here, so we should be dialed in. If results get noisy, tighten the filters with price, grade, condition, or exclusions.';
  if (tokens.length >= 4 || hasSetSignal) return 'Good detail to start with! If results get noisy, tighten the filters with price, grade, condition, or exclusions.';
  return 'This one is broad, so it may cast a wider net. Add a set, card number, language, or variant to sharpen it.';
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
    values.hasCustomNegativeKeywords ? 'custom exclusions' : undefined
  ].filter((value): value is string => Boolean(value));
}

export async function handleChaseAddAutocomplete(interaction: any): Promise<boolean> {
  if (!interaction.isAutocomplete()) return false;
  if (interaction.commandName !== 'chase') return false;
  if (interaction.options.getSubcommand() !== 'add') return false;
  const focused = interaction.options.getFocused(true);
  if (focused.name !== 'card') return false;

  const query = String(focused.value ?? '').trim();
  const choices = await autocompleteChaseCards(query, 25);
  await interaction.respond(choices);
  return true;
}

export const chaseAdd = {
  async execute(interaction: any) {
    const plan = getUserPlan(interaction.user.id);
    const activeTier = activePlanTier(plan);
    const entitlements = getEntitlementsForTier(activeTier);
    const currentCount = countUserChases(interaction.user.id);
    const maxChases = PLAN_LIMITS[activeTier].maxActiveChases;

    if (currentCount >= maxChases) {
      const message =
        activeTier === 'PRO'
          ? `You have reached your Pro limit of ${maxChases} active chases. Remove one with /chase remove before adding another`
          : freeVaultLimitMessage('Remove one with `/chase remove` or run `/upgrade`');
      await interaction.reply({
        embeds: [warningEmbed('Vault Limit Reached', message)],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const cardName = interaction.options.getString('card', true);
    const existingDuplicate = listChases(interaction.user.id).find((chase) => normalizeChaseName(chase.cardName) === normalizeChaseName(cardName));
    if (existingDuplicate) {
      await interaction.reply({
        embeds: [warningEmbed('Already In Vault', `**${existingDuplicate.cardName}** is already an active chase`)],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

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
    const tuningTermsRaw = interaction.options.getString('custom_exclusions');
    const hasCustomNegativeKeywords =
      tuningTermsRaw !== null &&
      tuningTermsRaw
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
    const tuningTerms = canUsePrecisionControls
      ? tuningTermsRaw
          ?.split(',')
          .map((k: string) => k.trim())
          .filter(Boolean)
      : undefined;

    if (tuningTerms && tuningTerms.length > 15) {
      await interaction.reply({
        embeds: [warningEmbed('Too Many Custom Exclusions', 'Use at most 15 comma-separated custom exclusions')],
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
      negativeKeywords: tuningTerms && tuningTerms.length > 0 ? tuningTerms : undefined
    });

    const lines = [
      'Nice pick! Vaultr is on it 🫡',
      chaseNameQualityLine(chase.cardName),
      '',
      `**Card:** ${chase.cardName}`,
      `**Priority:** ${chase.priority ?? 'NORMAL'}`,
      `**Note:** ${orNone(chase.targetNote)}`,
      `**Max Price:** ${chase.maxPrice ?? OUTPUT_STYLE.any}`,
      `**Grade:** ${displayGrade(chase.grade)}`,
      `**Condition:** ${displayCondition(chase.condition)}`,
      `**Listing Type:** ${displayAny(chase.listingType)}`,
      `**Custom Exclusions:** ${chase.negativeKeywords?.join(', ') ?? OUTPUT_STYLE.none}`,
      `**Default Exclusions:** ${DEFAULT_NEGATIVE_KEYWORDS.join(', ')}`,
      ...(blockedProControls.length > 0
        ? [
            '',
            `**Pro Controls Not Applied:** ${blockedProControls.join(', ')}`,
            proControlsNextLine()
          ]
        : []),
      '',
      '**Next:** Use `/chase list` to review active chases'
    ];

    const embed = successEmbed('Chase Added', lines.join('\n')).setTitle('✅ Chase Added');
    const previewImage = getCachedChaseCardPreviewImage(chase.cardName);
    if (previewImage) embed.setThumbnail(previewImage);

    await interaction.reply({
      embeds: [embed],
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
            `🏁 **${displayName}** started their **Vault** with their first chase`
          );
        }
      }
    }
  }
};
