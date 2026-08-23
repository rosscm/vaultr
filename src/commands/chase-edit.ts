import { MessageFlags } from 'discord.js';
import { autocompleteChaseCards } from '../services/chase-card-catalog.js';
import { getVaultChases, updateUserChase } from '../services/chase-service.js';
import type { Chase } from '../types.js';
import { errorEmbed, successEmbed, warningEmbed } from '../ui/embeds.js';
import { OUTPUT_STYLE, displayCondition, displayGrade, orNone } from '../ui/style.js';
import { proControlsNextLine } from './pro-copy.js';

function displayAny(value: string | undefined): string {
  if (!value || value === 'ANY') return OUTPUT_STYLE.any;
  return value;
}

function chaseDetailLines(chase: Chase): string[] {
  return [
    `**Card:** ${chase.cardName}`,
    `**Priority:** ${chase.priority ?? 'NORMAL'}`,
    `**Note:** ${orNone(chase.targetNote)}`,
    `**Max Price:** ${chase.maxPrice ?? OUTPUT_STYLE.any}`,
    `**Grade:** ${displayGrade(chase.grade)}`,
    `**Condition:** ${displayCondition(chase.condition)}`,
    `**Listing Type:** ${displayAny(chase.listingType)}`,
    `**Custom Exclusions:** ${chase.negativeKeywords?.join(', ') ?? OUTPUT_STYLE.none}`
  ];
}

function chaseChoiceName(chase: Chase, entry: number): string {
  const details = [
    chase.maxPrice !== undefined ? `Max ${chase.maxPrice}` : undefined,
    chase.grade ? displayGrade(chase.grade) : undefined,
    chase.priority && chase.priority !== 'NORMAL' ? chase.priority : undefined
  ].filter(Boolean);
  const suffix = details.length > 0 ? ` — ${details.join(' · ')}` : '';
  return `#${entry} ${chase.cardName}${suffix}`.slice(0, 100);
}

function resolveChaseSelection(chases: Chase[], value: string): { chase: Chase; entry: number } | null {
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

export async function handleChaseEditAutocomplete(interaction: any): Promise<boolean> {
  if (!interaction.isAutocomplete()) return false;
  if (interaction.commandName !== 'chase') return false;
  if (interaction.options.getSubcommand() !== 'edit') return false;
  const focused = interaction.options.getFocused(true);

  if (focused.name === 'card') {
    const query = String(focused.value ?? '').trim();
    const choices = await autocompleteChaseCards(query, 25);
    await interaction.respond(choices);
    return true;
  }

  if (focused.name !== 'chase') return false;

  const query = String(focused.value ?? '').trim().toLowerCase();
  const chases = getVaultChases(interaction.user.id).chases.map((view) => view.chase);
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
    const chases = getVaultChases(interaction.user.id).chases.map((view) => view.chase);
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
    const gradingType = (interaction.options.getString('grading_type') as Parameters<typeof updateUserChase>[0]['changes']['gradingType']) ?? undefined;
    const gradeValue = (interaction.options.getString('grade_value') as Parameters<typeof updateUserChase>[0]['changes']['gradeValue']) ?? undefined;
    const condition = (interaction.options.getString('condition') as Parameters<typeof updateUserChase>[0]['changes']['condition']) ?? undefined;
    const listingType = (interaction.options.getString('listing_type') as 'ANY' | 'AUCTION' | 'BUY_IT_NOW' | null) ?? undefined;
    const priority = (interaction.options.getString('priority') as 'GRAIL' | 'HIGH' | 'NORMAL' | null) ?? undefined;
    const targetNoteRaw = interaction.options.getString('target_note');
    const negativeKeywordsRaw = interaction.options.getString('custom_exclusions');

    const result = updateUserChase({
      userId: interaction.user.id,
      chaseId: match.id,
      changes: {
        cardName,
        maxPrice,
        gradingType,
        gradeValue,
        condition,
        listingType,
        priority,
        targetNote: targetNoteRaw ?? undefined,
        customExclusions: negativeKeywordsRaw ?? undefined
      }
    });

    if (!result.ok) {
      if (result.code === 'INVALID_INPUT') {
        await interaction.reply({
          embeds: [warningEmbed('Invalid Chase Input', result.message ?? 'Check the chase details and try again')],
          flags: MessageFlags.Ephemeral
        });
        return;
      }
      if (result.code === 'CHASE_NOT_FOUND') {
        await interaction.reply({ embeds: [errorEmbed('Update Failed', 'Unable to update chase')], flags: MessageFlags.Ephemeral });
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
      if (result.code === 'NO_CHANGES_REQUESTED') {
        await interaction.reply({
          embeds: [warningEmbed('Nothing To Edit', 'Choose at least one edit field after picking a chase')],
          flags: MessageFlags.Ephemeral
        });
        return;
      }
      if (result.code === 'NO_APPLICABLE_CHANGES') {
        await interaction.reply({
          embeds: [
            warningEmbed(
              'Pro Controls Not Applied',
              `Free Vaults cannot change ${result.blockedControls?.join(', ') ?? 'those controls'}.\n\n${proControlsNextLine()}`
            )
          ],
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
      await interaction.reply({ embeds: [errorEmbed('Update Failed', 'Unable to update chase')], flags: MessageFlags.Ephemeral });
      return;
    }

    const lines = [
      ...chaseDetailLines(result.chase),
      ...(result.blockedControls.length > 0
        ? [
            '',
            `**Pro Controls Not Applied:** ${result.blockedControls.join(', ')}`,
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
