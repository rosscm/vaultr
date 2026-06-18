import { MessageFlags } from 'discord.js';
import { getUserPlan, listChases, updateChase } from '../services/chase-store.js';
import { getEntitlementsForTier } from '../services/entitlements.js';
import { activePlanTier } from '../services/plans.js';
import { errorEmbed, successEmbed, warningEmbed } from '../ui/embeds.js';
import { OUTPUT_STYLE, displayCondition, displayGrade, orNone } from '../ui/style.js';
import { buildGradePreference, gradeSelectionWarning, inferGradingTypeFromGrade, normalizeConditionChoice } from './chase-options.js';
import { proControlsNextLine } from './pro-copy.js';

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
    `**Tune-Out Terms:** ${chase.negativeKeywords?.join(', ') ?? OUTPUT_STYLE.none}`
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

function resolveChaseSelection(chases: ReturnType<typeof listChases>, value: string): { chase: ReturnType<typeof listChases>[number]; entry: number } | null {
  const trimmed = value.trim();
  const byId = chases.find((chase) => chase.id === trimmed);
  if (byId) return { chase: byId, entry: chases.findIndex((chase) => chase.id === byId.id) + 1 };

  const entryMatch = /^(?:#|no\.?\s*)?(\d+)\b/i.exec(trimmed);
  if (entryMatch) {
    const entry = Number.parseInt(entryMatch[1], 10);
    const chase = chases[entry - 1];
    if (chase) return { chase, entry };
  }

  const normalized = trimmed.toLowerCase();
  const byName = chases.find((chase) => chase.cardName.toLowerCase() === normalized);
  if (byName) return { chase: byName, entry: chases.findIndex((chase) => chase.id === byName.id) + 1 };

  return null;
}

function parseNegativeKeywords(value: string): string[] | null {
  if (/^(none|clear|any)$/i.test(value.trim())) return null;
  const keywords = value
    .split(',')
    .map((keyword) => keyword.trim())
    .filter(Boolean);
  return keywords.length > 0 ? keywords : null;
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
    values.negativeKeywordsRaw !== null ? 'tune-out terms' : undefined
  ].filter((value): value is string => Boolean(value));
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
    const selection = resolveChaseSelection(chases, chaseId);
    const match = selection?.chase;
    const matchEntry = selection?.entry;

    if (!match) {
      await interaction.reply({
        embeds: [errorEmbed('Chase Not Found', 'That saved chase could not be found. Pick from the `chase` menu or enter its list number')],
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
    const targetNote = targetNoteRaw === null ? undefined : /^(none|clear)$/i.test(targetNoteRaw.trim()) ? null : targetNoteRaw;
    const negativeKeywordsRaw = interaction.options.getString('tune_out_terms') ?? interaction.options.getString('tuning_terms') ?? interaction.options.getString('negative_keywords');
    const plan = getUserPlan(interaction.user.id);
    const activeTier = activePlanTier(plan);
    const entitlements = getEntitlementsForTier(activeTier);
    const blockedProControls = entitlements.advancedFiltering ? [] : proControlNames({ conditionRaw, listingType, priority, targetNoteRaw, negativeKeywordsRaw });
    const canUsePrecisionControls = entitlements.advancedFiltering;
    const negativeKeywords = !canUsePrecisionControls || negativeKeywordsRaw === null ? undefined : parseNegativeKeywords(negativeKeywordsRaw);

    if (negativeKeywords && negativeKeywords.length > 15) {
      await interaction.reply({
        embeds: [warningEmbed('Too Many Tune-Out Terms', 'Use at most 15 comma-separated tune-out terms')],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (!cardName && maxPrice === undefined && grade === undefined && condition === undefined && !listingType && !priority && targetNote === undefined && negativeKeywords === undefined) {
      await interaction.reply({
        embeds: [warningEmbed('Nothing To Edit', 'Choose at least one edit field after picking a chase')],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (!cardName && maxPrice === undefined && grade === undefined && blockedProControls.length > 0) {
    await interaction.reply({
        embeds: [
          warningEmbed(
            'Pro Controls Not Applied',
            `Free Vaults cannot change ${blockedProControls.join(', ')}.\n\n${proControlsNextLine()}`
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
      await interaction.reply({ embeds: [errorEmbed('Update Failed', 'Unable to update chase')], flags: MessageFlags.Ephemeral });
      return;
    }

    const lines = [
      ...chaseDetailLines(updated),
      ...(blockedProControls.length > 0
        ? [
            '',
            `**Pro Controls Not Applied:** ${blockedProControls.join(', ')}`,
            proControlsNextLine()
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
