import { MessageFlags } from 'discord.js';
import {
  getGuildCommunityFeedMode,
  getGuildCommandChannel,
  markGuildUserStarted
} from '../services/chase-store.js';
import { autocompleteChaseCards } from '../services/chase-card-catalog.js';
import { addUserChase, type ChaseAdvancedControl } from '../services/chase-service.js';
import type { Chase } from '../types.js';
import { successEmbed, warningEmbed } from '../ui/embeds.js';
import { OUTPUT_STYLE, displayCondition, displayGrade, orNone } from '../ui/style.js';
import { freeVaultLimitMessage, proControlsNextLine } from './pro-copy.js';

const DEFAULT_NEGATIVE_KEYWORDS = ['proxy', 'custom', 'reprint', 'lot', 'orica', 'replica', 'fan art', 'novelty', 'keychain', 'extended art', 'acrylic case', 'magnetic case'];

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

function broadChaseNudge(cardName: string): string {
  const tokens = cardName.trim().split(/\s+/).filter(Boolean);
  const hasNumber = /\b\d{1,4}\s*[/#-]\s*\d{1,4}\b|\b[A-Z]{1,4}\d{1,4}\b/i.test(cardName);
  if (hasNumber && tokens.length >= 2) {
    return 'Good card choice. With no filters yet, this chase is still wide open, so add a max price, grade, or a few exclusions if results get noisy.';
  }
  return 'This chase is wide open right now, so add a set, card number, max price, grade, or a few exclusions if results get noisy.';
}

function buildChaseAddedEmbed(
  chase: Chase,
  blockedProControls: ChaseAdvancedControl[]
) {
  const noFiltersApplied = addedWithoutFilters({
    maxPrice: chase.maxPrice,
    grade: chase.grade,
    condition: chase.condition,
    listingType: chase.listingType,
    negativeKeywords: chase.negativeKeywords
  });
  const lines = [
    'Nice pick! Vaultr is on it 🫡',
    noFiltersApplied ? broadChaseNudge(chase.cardName) : chaseNameQualityLine(chase.cardName),
    ...(noFiltersApplied
      ? [
          'Tip: start broad if you want, then tighten it once you see the kinds of listings that show up.'
        ]
      : []),
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
  if (chase.cardImageUrl) embed.setThumbnail(chase.cardImageUrl);
  return embed;
}

function addedWithoutFilters(values: {
  maxPrice: number | undefined;
  grade: string | undefined;
  condition: string | undefined;
  listingType: string | undefined;
  negativeKeywords: string[] | undefined;
}): boolean {
  return (
    values.maxPrice === undefined &&
    values.grade === undefined &&
    values.condition === undefined &&
    (!values.listingType || values.listingType === 'ANY') &&
    (!values.negativeKeywords || values.negativeKeywords.length === 0)
  );
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
    const cardName = interaction.options.getString('card', true);
    const maxPrice = interaction.options.getNumber('max_price') ?? undefined;
    const gradingType = interaction.options.getString('grading_type') as Parameters<typeof addUserChase>[0]['gradingType'];
    const gradeValue = interaction.options.getString('grade_value') as Parameters<typeof addUserChase>[0]['gradeValue'];
    const condition = interaction.options.getString('condition') as Parameters<typeof addUserChase>[0]['condition'];
    const listingTypeRaw = interaction.options.getString('listing_type') as 'ANY' | 'AUCTION' | 'BUY_IT_NOW' | null;
    const priorityRaw = interaction.options.getString('priority') as 'GRAIL' | 'HIGH' | 'NORMAL' | null;
    const targetNote = interaction.options.getString('target_note') ?? undefined;
    const tuningTermsRaw = interaction.options.getString('custom_exclusions');

    const result = addUserChase({
      userId: interaction.user.id,
      guildId: interaction.guildId ?? undefined,
      cardName,
      maxPrice,
      gradingType,
      gradeValue,
      condition,
      listingType: listingTypeRaw,
      priority: priorityRaw,
      targetNote,
      customExclusions: tuningTermsRaw
    });

    if (!result.ok) {
      if (result.code === 'INVALID_INPUT') {
        await interaction.reply({
          embeds: [warningEmbed('Invalid Chase Input', result.message ?? 'Check the chase details and try again')],
          flags: MessageFlags.Ephemeral
        });
        return;
      }
      if (result.code === 'VAULT_LIMIT_REACHED') {
        const message =
          result.activeTier === 'PRO'
            ? `You have reached your Pro limit of ${result.maxChases} active chases. Remove one with /chase remove before adding another`
            : freeVaultLimitMessage('Remove one with `/chase remove` or run `/upgrade`');
        await interaction.reply({
          embeds: [warningEmbed('Vault Limit Reached', message)],
          flags: MessageFlags.Ephemeral
        });
        return;
      }
      if (result.code === 'DUPLICATE_CHASE') {
        await interaction.reply({
          embeds: [warningEmbed('Already In Vault', `**${result.duplicateChase?.cardName ?? cardName}** is already an active chase`)],
          flags: MessageFlags.Ephemeral
        });
        return;
      }
      if (result.code === 'INVALID_GRADE_PREFERENCE') {
        await interaction.reply({
          embeds: [warningEmbed('Invalid Grade Preference', result.message ?? 'Choose a valid grade preference')],
          flags: MessageFlags.Ephemeral
        });
        return;
      }
      if (result.code === 'TOO_MANY_CUSTOM_EXCLUSIONS') {
        await interaction.reply({
          embeds: [warningEmbed('Too Many Custom Exclusions', 'Use at most 15 comma-separated custom exclusions')],
          flags: MessageFlags.Ephemeral
        });
        return;
      }
      await interaction.reply({
        embeds: [warningEmbed('Chase Not Added', result.message ?? 'Unable to add this chase')],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const embed = buildChaseAddedEmbed(result.chase, result.blockedControls);

    await interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral
    });

    // Optional community message: only once per user per guild.
    if (interaction.guildId && getGuildCommunityFeedMode(interaction.guildId) !== 'OFF' && result.isFirstChase) {
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
