import { ActionRowBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { getUserPlan, listChases, updateChase } from '../services/chase-store.js';
import { getEntitlementsForTier } from '../services/entitlements.js';
import { activePlanTier, PLAN_LIMITS } from '../services/plans.js';
import { errorEmbed, successEmbed, warningEmbed } from '../ui/embeds.js';
import { OUTPUT_STYLE, displayCondition, displayGrade, orNone } from '../ui/style.js';
import { buildGradePreference, gradeSelectionWarning, inferGradingTypeFromGrade, normalizeConditionChoice } from './chase-options.js';

const CHASE_EDIT_MODAL_PREFIX = 'chase-edit-modal';

function displayAny(value: string | undefined): string {
  if (!value || value === 'ANY') return OUTPUT_STYLE.any;
  return value;
}

function chaseDetailLines(chase: ReturnType<typeof listChases>[number]): string[] {
  return [
    `**Card:** ${chase.cardName}`,
    `**Priority:** ${chase.priority ?? 'NORMAL'}`,
    `**Note:** ${orNone(chase.targetNote)}`,
    `**Max Price:** ${chase.maxPrice ?? OUTPUT_STYLE.any}`,
    `**Grade:** ${displayGrade(chase.grade)}`,
    `**Condition:** ${displayCondition(chase.condition)}`,
    `**Listing Type:** ${displayAny(chase.listingType)}`,
    `**Blocked Terms:** ${chase.negativeKeywords?.join(', ') ?? OUTPUT_STYLE.none}`
  ];
}

function chaseChoiceName(chase: ReturnType<typeof listChases>[number], entry: number): string {
  const details = [
    chase.maxPrice !== undefined ? `Max ${chase.maxPrice}` : undefined,
    chase.grade ? displayGrade(chase.grade) : undefined,
    chase.priority && chase.priority !== 'NORMAL' ? chase.priority : undefined
  ].filter(Boolean);
  const suffix = details.length > 0 ? ` — ${details.join(' · ')}` : '';
  return `#${entry} ${chase.cardName}${suffix}`.slice(0, 100);
}

function addOptionalValue(input: TextInputBuilder, value: string | undefined): TextInputBuilder {
  return value && value.length > 0 ? input.setValue(value) : input;
}

function optionalTextInputValue(interaction: any, customId: string): string | undefined {
  try {
    return interaction.fields.getTextInputValue(customId);
  } catch {
    return undefined;
  }
}

function proControlNames(values: {
  conditionRaw: string | null;
  listingType: string | undefined;
  priority: string | undefined;
  targetNoteRaw: string | null;
  negativeKeywordsRaw: string | null;
}): string[] {
  return [
    values.conditionRaw !== null && values.conditionRaw !== 'ANY' ? 'condition' : undefined,
    values.listingType !== undefined && values.listingType !== 'ANY' ? 'listing type' : undefined,
    values.priority !== undefined && values.priority !== 'NORMAL' ? 'priority' : undefined,
    values.targetNoteRaw !== null ? 'note' : undefined,
    values.negativeKeywordsRaw !== null ? 'blocked terms' : undefined
  ].filter((value): value is string => Boolean(value));
}

function chaseEditModal(userId: string, chase: ReturnType<typeof listChases>[number], entry: number, includeProControls: boolean): ModalBuilder {
  const card = new TextInputBuilder()
    .setCustomId('card')
    .setLabel('Card')
    .setStyle(TextInputStyle.Short)
    .setMinLength(3)
    .setMaxLength(100)
    .setRequired(true)
    .setValue(chase.cardName);
  const maxPrice = addOptionalValue(
    new TextInputBuilder()
      .setCustomId('max_price')
      .setLabel('Max price')
      .setStyle(TextInputStyle.Short)
      .setMaxLength(20)
      .setRequired(false)
      .setPlaceholder('Blank for any price'),
    chase.maxPrice === undefined ? undefined : String(chase.maxPrice)
  );
  const grade = addOptionalValue(
    new TextInputBuilder()
      .setCustomId('grade')
      .setLabel('Grade')
      .setStyle(TextInputStyle.Short)
      .setMaxLength(40)
      .setRequired(false)
      .setPlaceholder('Blank for Any, or PSA 10 / Ungraded'),
    chase.grade
  );
  const components = [
    new ActionRowBuilder<TextInputBuilder>().addComponents(card),
    new ActionRowBuilder<TextInputBuilder>().addComponents(maxPrice),
    new ActionRowBuilder<TextInputBuilder>().addComponents(grade)
  ];

  if (includeProControls) {
    const targetNote = addOptionalValue(
      new TextInputBuilder()
        .setCustomId('target_note')
        .setLabel('Note')
        .setStyle(TextInputStyle.Short)
        .setMaxLength(120)
        .setRequired(false)
        .setPlaceholder('What makes this chase special'),
      chase.targetNote
    );
    const negativeKeywords = addOptionalValue(
      new TextInputBuilder()
        .setCustomId('negative_keywords')
        .setLabel('Blocked terms')
        .setStyle(TextInputStyle.Paragraph)
        .setMaxLength(240)
        .setRequired(false)
        .setPlaceholder('Comma-separated terms to block'),
      chase.negativeKeywords?.join(', ')
    );
    components.push(
      new ActionRowBuilder<TextInputBuilder>().addComponents(targetNote),
      new ActionRowBuilder<TextInputBuilder>().addComponents(negativeKeywords)
    );
  }

  return new ModalBuilder()
    .setCustomId(`${CHASE_EDIT_MODAL_PREFIX}:${userId}:${chase.id}`)
    .setTitle(`Edit #${entry}`.slice(0, 45))
    .addComponents(...components);
}

function normalizeModalGrade(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0 || /^any$/i.test(trimmed)) return null;
  if (/^(raw|ungraded)$/i.test(trimmed)) return 'UNGRADED';
  return trimmed;
}

function parseModalMaxPrice(value: string): number | null | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0 || /^any$/i.test(trimmed)) return null;
  const parsed = Number(trimmed.replace(/[$,]/g, ''));
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}

function parseModalNegativeKeywords(value: string): string[] | null {
  const keywords = value
    .split(',')
    .map((keyword) => keyword.trim())
    .filter(Boolean);
  return keywords.length > 0 ? keywords : null;
}

export async function handleChaseEditAutocomplete(interaction: any): Promise<boolean> {
  if (!interaction.isAutocomplete()) return false;
  if (interaction.commandName !== 'chase') return false;
  if (interaction.options.getSubcommand() !== 'edit') return false;
  const focused = interaction.options.getFocused(true);
  if (focused.name !== 'chase') return false;

  const query = String(focused.value ?? '').trim().toLowerCase();
  const chases = listChases(interaction.user.id);
  const entryById = new Map(chases.map((chase, index) => [chase.id, index + 1]));
  const matches = chases
    .filter((chase, index) => {
      if (query.length === 0) return index < 25;
      const entry = String(index + 1);
      return entry === query || chase.cardName.toLowerCase().includes(query);
    })
    .slice(0, 25)
    .map((chase) => ({
      name: chaseChoiceName(chase, entryById.get(chase.id) ?? 0),
      value: chase.id
    }));

  await interaction.respond(matches);
  return true;
}

export const chaseEdit = {
  async execute(interaction: any) {
    const chaseId = interaction.options.getString('chase', true);
    const chases = listChases(interaction.user.id);
    const entryById = new Map(chases.map((chase, index) => [chase.id, index + 1]));
    const match = chases.find((chase) => chase.id === chaseId);
    const matchEntry = match ? entryById.get(match.id) : undefined;

    if (!match) {
      await interaction.reply({
        embeds: [errorEmbed('Chase Not Found', 'That saved chase could not be found. Try the `chase` picker again.')],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const cardName = interaction.options.getString('card') ?? undefined;
    const maxPrice = interaction.options.getNumber('max_price') ?? undefined;
    const gradingType = interaction.options.getString('grading_type') as Parameters<typeof buildGradePreference>[0];
    const gradeValue = interaction.options.getString('grade_value') as Parameters<typeof buildGradePreference>[1];
    const effectiveGradingType = gradingType ?? (gradeValue !== null ? inferGradingTypeFromGrade(match.grade) ?? null : null);
    const gradeWarning = gradeSelectionWarning(effectiveGradingType, gradeValue);
    if (gradeWarning) {
      await interaction.reply({
        embeds: [warningEmbed('Invalid Grade Preference', gradeWarning)],
        flags: MessageFlags.Ephemeral
      });
      return;
    }
    const grade = buildGradePreference(effectiveGradingType, gradeValue);
    const conditionRaw = interaction.options.getString('condition') as Parameters<typeof normalizeConditionChoice>[0];
    const condition = normalizeConditionChoice(conditionRaw);
    const listingType = (interaction.options.getString('listing_type') as 'ANY' | 'AUCTION' | 'BUY_IT_NOW' | null) ?? undefined;
    const priority = (interaction.options.getString('priority') as 'GRAIL' | 'HIGH' | 'NORMAL' | null) ?? undefined;
    const targetNoteRaw = interaction.options.getString('target_note');
    const targetNote = targetNoteRaw === null ? undefined : targetNoteRaw;
    const negativeKeywordsRaw = interaction.options.getString('negative_keywords');
    const plan = getUserPlan(interaction.user.id);
    const activeTier = activePlanTier(plan);
    const entitlements = getEntitlementsForTier(activeTier);
    const blockedProControls = entitlements.advancedFiltering ? [] : proControlNames({ conditionRaw, listingType, priority, targetNoteRaw, negativeKeywordsRaw });
    const canUsePrecisionControls = entitlements.advancedFiltering;

    const negativeKeywords =
      !canUsePrecisionControls || negativeKeywordsRaw === null
        ? undefined
        : negativeKeywordsRaw
            .split(',')
            .map((k: string) => k.trim())
            .filter(Boolean);

    if (negativeKeywords && negativeKeywords.length > 15) {
      await interaction.reply({
        embeds: [warningEmbed('Too Many Blocked Terms', 'Use at most 15 comma-separated blocked terms.')],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (
      !cardName &&
      maxPrice === undefined &&
      grade === undefined &&
      condition === undefined &&
      !listingType &&
      !priority &&
      targetNote === undefined &&
      negativeKeywords === undefined
    ) {
      await interaction.showModal(chaseEditModal(interaction.user.id, match, matchEntry ?? 0, entitlements.advancedFiltering));
      return;
    }

    if (
      !cardName &&
      maxPrice === undefined &&
      grade === undefined &&
      blockedProControls.length > 0
    ) {
      await interaction.reply({
        embeds: [
          warningEmbed(
            'Pro Controls Not Applied',
            `Free Vaults cannot change ${blockedProControls.join(', ')}.\n\n**Next:** use \`/upgrade\` to unlock ${PLAN_LIMITS.PRO.maxActiveChases} active chases and precision controls`
          )
        ],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const updated = updateChase(interaction.user.id, match.id, {
      cardName,
      priority: canUsePrecisionControls ? priority : undefined,
      targetNote: canUsePrecisionControls ? targetNote : undefined,
      maxPrice,
      grade,
      condition: canUsePrecisionControls ? condition : undefined,
      listingType: canUsePrecisionControls ? listingType : undefined,
      negativeKeywords
    });

    if (!updated) {
      await interaction.reply({ embeds: [errorEmbed('Update Failed', 'Unable to update chase.')], flags: MessageFlags.Ephemeral });
      return;
    }

    const lines = [
      ...chaseDetailLines(updated),
      ...(blockedProControls.length > 0
        ? [
            '',
            `**Pro Controls Not Applied:** ${blockedProControls.join(', ')}`,
            `**Next:** use \`/upgrade\` to unlock ${PLAN_LIMITS.PRO.maxActiveChases} active chases and precision controls`
          ]
        : []),
      '',
      '**Next:** Use `/chase list` to confirm ordering and details'
    ];

    await interaction.reply({
      embeds: [successEmbed(`Chase #${matchEntry} Updated`, lines.join('\n')).setTitle(`✅ Chase #${matchEntry} Updated`)],
      flags: MessageFlags.Ephemeral
    });
  }
};

export async function handleChaseEditModal(interaction: any): Promise<boolean> {
  if (!interaction.isModalSubmit()) return false;
  if (!interaction.customId.startsWith(`${CHASE_EDIT_MODAL_PREFIX}:`)) return false;
  const [, ownerUserId, chaseId] = interaction.customId.split(':');
  if (interaction.user.id !== ownerUserId) {
    await interaction.reply({ embeds: [warningEmbed('Edit Belongs Elsewhere', 'Only the original requester can update this chase.')], flags: MessageFlags.Ephemeral });
    return true;
  }

  const chases = listChases(interaction.user.id);
  const entryById = new Map(chases.map((chase, index) => [chase.id, index + 1]));
  const match = chases.find((chase) => chase.id === chaseId);
  if (!match) {
    await interaction.reply({ embeds: [errorEmbed('Chase Not Found', 'That saved chase could not be found. Try `/chase edit` again.')], flags: MessageFlags.Ephemeral });
    return true;
  }

  const cardName = interaction.fields.getTextInputValue('card').trim();
  const maxPrice = parseModalMaxPrice(interaction.fields.getTextInputValue('max_price'));
  const grade = normalizeModalGrade(interaction.fields.getTextInputValue('grade'));
  const targetNoteRaw = optionalTextInputValue(interaction, 'target_note');
  const negativeKeywordsRaw = optionalTextInputValue(interaction, 'negative_keywords');
  const targetNoteValue = targetNoteRaw?.trim();
  const targetNote = targetNoteValue === undefined ? undefined : targetNoteValue.length > 0 ? targetNoteValue : null;
  const negativeKeywords = negativeKeywordsRaw === undefined ? undefined : parseModalNegativeKeywords(negativeKeywordsRaw);

  if (cardName.length < 3) {
    await interaction.reply({ embeds: [warningEmbed('Card Name Too Short', 'Use at least 3 characters for the card name.')], flags: MessageFlags.Ephemeral });
    return true;
  }
  if (maxPrice === undefined) {
    await interaction.reply({ embeds: [warningEmbed('Invalid Max Price', 'Use a number greater than 0, or leave max price blank for Any.')], flags: MessageFlags.Ephemeral });
    return true;
  }
  if (negativeKeywords && negativeKeywords.length > 15) {
    await interaction.reply({ embeds: [warningEmbed('Too Many Blocked Terms', 'Use at most 15 comma-separated blocked terms.')], flags: MessageFlags.Ephemeral });
    return true;
  }

  const plan = getUserPlan(interaction.user.id);
  const activeTier = activePlanTier(plan);
  const entitlements = getEntitlementsForTier(activeTier);
  const changedProFields =
    (targetNote !== undefined && targetNote !== (match.targetNote ?? null)) ||
    (negativeKeywords !== undefined && (negativeKeywords?.join(',') ?? null) !== (match.negativeKeywords?.join(',') ?? null));
  const blockedProControls = changedProFields && !entitlements.advancedFiltering ? ['note or blocked terms'] : [];
  if (blockedProControls.length > 0 && cardName === match.cardName && maxPrice === (match.maxPrice ?? null) && grade === (match.grade ?? null)) {
    await interaction.reply({
      embeds: [warningEmbed('Pro Controls Not Applied', `Free Vaults cannot change note or blocked terms.\n\n**Next:** use \`/upgrade\` to unlock ${PLAN_LIMITS.PRO.maxActiveChases} active chases and precision controls`)],
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  const updated = updateChase(interaction.user.id, match.id, {
    cardName,
    maxPrice,
    grade,
    targetNote: entitlements.advancedFiltering ? targetNote : undefined,
    negativeKeywords: entitlements.advancedFiltering ? negativeKeywords : undefined
  });

  if (!updated) {
    await interaction.reply({ embeds: [errorEmbed('Update Failed', 'Unable to update chase.')], flags: MessageFlags.Ephemeral });
    return true;
  }

  const entry = entryById.get(match.id) ?? 0;
  const lines = [
    ...chaseDetailLines(updated),
    ...(blockedProControls.length > 0
      ? [
          '',
          `**Pro Controls Not Applied:** ${blockedProControls.join(', ')}`,
          `**Next:** use \`/upgrade\` to unlock ${PLAN_LIMITS.PRO.maxActiveChases} active chases and precision controls`
        ]
      : []),
    '',
    '**Next:** Use `/chase list` to confirm ordering and details'
  ];
  await interaction.reply({
    embeds: [successEmbed(`Chase #${entry} Updated`, lines.join('\n')).setTitle(`✅ Chase #${entry} Updated`)],
    flags: MessageFlags.Ephemeral
  });
  return true;
}
