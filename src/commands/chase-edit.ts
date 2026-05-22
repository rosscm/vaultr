import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { listChases, updateChase } from '../services/chase-store.js';
import { errorEmbed, successEmbed, warningEmbed } from '../ui/embeds.js';
import { OUTPUT_STYLE, orAny, orNone } from '../ui/style.js';
const ALLOWED_CONDITIONS = new Set(['NM', 'LP', 'MP', 'HP', 'DMG']);

function displayAny(value: string | undefined): string {
  if (!value || value === 'ANY') return OUTPUT_STYLE.any;
  return value;
}

export const chaseEdit = {
  data: new SlashCommandBuilder()
    .setName('chase-edit')
    .setDescription('Edit an active chase by list entry number')
    .addIntegerOption((opt) => opt.setName('entry').setDescription('Entry number from /chase list').setRequired(true))
    .addStringOption((opt) =>
      opt.setName('card').setDescription('Updated card name (3-100 chars, casing ignored; default: keep current)').setMinLength(3).setMaxLength(100)
    )
    .addNumberOption((opt) => opt.setName('max_price').setDescription('Updated max price (> 0) (default: keep current)').setMinValue(0.01))
    .addStringOption((opt) => opt.setName('grade').setDescription('Updated grade, e.g. PSA 10 (default: keep current)').setMaxLength(24))
    .addStringOption((opt) =>
      opt
        .setName('condition')
        .setDescription('Updated condition(s): NM,LP,MP,HP,DMG (default: keep current)')
        .setMaxLength(40)
    )
    .addStringOption((opt) =>
      opt
        .setName('listing_type')
        .setDescription('Updated listing type (default: keep current)')
        .addChoices(
          { name: 'Any', value: 'ANY' },
          { name: 'Auction', value: 'AUCTION' },
          { name: 'Buy It Now', value: 'BUY_IT_NOW' }
        )
    )
    .addStringOption((opt) =>
      opt
        .setName('negative_keywords')
        .setDescription('Blocked terms (comma-separated, max 15) (default: keep current)')
        .setMaxLength(240)
    )
    .addStringOption((opt) =>
      opt
        .setName('priority')
        .setDescription('Updated priority (default: keep current)')
        .addChoices(
          { name: 'Normal', value: 'NORMAL' },
          { name: 'High', value: 'HIGH' },
          { name: 'Grail', value: 'GRAIL' }
        )
    )
    .addStringOption((opt) =>
      opt.setName('target_note').setDescription('Updated personal note (up to 120 chars) (default: keep current)').setMaxLength(120)
    ),
  async execute(interaction: any) {
    const entry = interaction.options.getInteger('entry', true);
    const chases = listChases(interaction.user.id);
    const match = chases[entry - 1];

    if (!match) {
      await interaction.reply({
        embeds: [errorEmbed('Entry Not Found', `No chase found at entry \`${entry}\`. Use /chase list first.`)],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const cardName = interaction.options.getString('card') ?? undefined;
    const maxPrice = interaction.options.getNumber('max_price') ?? undefined;
    const grade = interaction.options.getString('grade') ?? undefined;
    const conditionRaw = interaction.options.getString('condition');
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
    const listingType = (interaction.options.getString('listing_type') as 'ANY' | 'AUCTION' | 'BUY_IT_NOW' | null) ?? undefined;
    const priority = (interaction.options.getString('priority') as 'GRAIL' | 'HIGH' | 'NORMAL' | null) ?? undefined;
    const targetNoteRaw = interaction.options.getString('target_note');
    const targetNote = targetNoteRaw === null ? undefined : targetNoteRaw;
    const negativeKeywordsRaw = interaction.options.getString('negative_keywords');
    const negativeKeywords =
      negativeKeywordsRaw === null
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
      !grade &&
      !condition &&
      !listingType &&
      !priority &&
      targetNote === undefined &&
      negativeKeywords === undefined
    ) {
      await interaction.reply({
        embeds: [warningEmbed('No Changes Provided', 'Set at least one field to update.')],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const updated = updateChase(interaction.user.id, match.id, {
      cardName,
      priority,
      targetNote,
      maxPrice,
      grade,
      condition,
      listingType,
      negativeKeywords
    });

    if (!updated) {
      await interaction.reply({ embeds: [errorEmbed('Update Failed', 'Unable to update chase.')], flags: MessageFlags.Ephemeral });
      return;
    }

    const lines = [
      `**Card:** ${updated.cardName}`,
      `**Priority:** ${updated.priority ?? 'NORMAL'}`,
      `**Note:** ${orNone(updated.targetNote)}`,
      `**Max Price:** ${updated.maxPrice ?? OUTPUT_STYLE.any}`,
      `**Grade:** ${orAny(updated.grade)}`,
      `**Condition:** ${orAny(updated.condition)}`,
      `**Listing Type:** ${displayAny(updated.listingType)}`,
      `**Blocked Terms:** ${updated.negativeKeywords?.join(', ') ?? OUTPUT_STYLE.none}`,
      '',
      '**Next:** Use `/chase list` to confirm ordering and details'
    ];

    await interaction.reply({
      embeds: [successEmbed(`Chase #${entry} Updated`, lines.join('\n')).setTitle(`✅ Chase #${entry} Updated`)],
      flags: MessageFlags.Ephemeral
    });
  }
};
