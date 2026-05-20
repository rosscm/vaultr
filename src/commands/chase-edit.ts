import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { listChases, updateChase } from '../services/chase-store.js';
import { errorEmbed, keyValue, successEmbed, warningEmbed } from '../ui/embeds.js';
import { OUTPUT_STYLE, orAny, orNone } from '../ui/style.js';

export const chaseEdit = {
  data: new SlashCommandBuilder()
    .setName('chase-edit')
    .setDescription('Edit an active chase by list entry number')
    .addIntegerOption((opt) => opt.setName('entry').setDescription('Entry number from /chase-list').setRequired(true))
    .addStringOption((opt) =>
      opt.setName('card').setDescription('Updated card name (3-100 chars, casing ignored)').setMinLength(3).setMaxLength(100)
    )
    .addNumberOption((opt) => opt.setName('max_price').setDescription('Updated max price (> 0)').setMinValue(0.01))
    .addStringOption((opt) => opt.setName('grade').setDescription('Updated grade, e.g. PSA 10').setMaxLength(24))
    .addStringOption((opt) =>
      opt
        .setName('condition')
        .setDescription('Updated condition preference')
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
        .setDescription('Updated seller region')
        .addChoices(
          { name: 'Any', value: 'ANY' },
          { name: 'Canada', value: 'CA' },
          { name: 'United States', value: 'US' }
        )
    )
    .addStringOption((opt) =>
      opt
        .setName('listing_type')
        .setDescription('Updated listing type')
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
        .setDescription('Updated priority')
        .addChoices(
          { name: 'Normal', value: 'NORMAL' },
          { name: 'High', value: 'HIGH' },
          { name: 'Grail', value: 'GRAIL' }
        )
    )
    .addStringOption((opt) =>
      opt.setName('target_note').setDescription('Updated personal note (up to 120 chars)').setMaxLength(120)
    ),
  async execute(interaction: any) {
    const entry = interaction.options.getInteger('entry', true);
    const chases = listChases(interaction.user.id);
    const match = chases[entry - 1];

    if (!match) {
      await interaction.reply({
        embeds: [errorEmbed('Entry Not Found', `No chase found at entry \`${entry}\`. Use /chase-list first.`)],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const cardName = interaction.options.getString('card') ?? undefined;
    const maxPrice = interaction.options.getNumber('max_price') ?? undefined;
    const grade = interaction.options.getString('grade') ?? undefined;
    const condition = interaction.options.getString('condition') ?? undefined;
    const region = (interaction.options.getString('region') as 'CA' | 'US' | 'ANY' | null) ?? undefined;
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
      !region &&
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
      region,
      listingType,
      negativeKeywords
    });

    if (!updated) {
      await interaction.reply({ embeds: [errorEmbed('Update Failed', 'Unable to update chase.')], flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.reply({
      embeds: [
        successEmbed(`Chase #${entry} Updated`).addFields(
          keyValue('Card', updated.cardName),
          keyValue('Priority', updated.priority ?? 'NORMAL'),
          keyValue('Max Price', `${updated.maxPrice ?? OUTPUT_STYLE.any}`),
          keyValue('Grade', orAny(updated.grade)),
          keyValue('Condition', orAny(updated.condition)),
          keyValue('Region', updated.region ?? OUTPUT_STYLE.any),
          keyValue('Listing Type', updated.listingType ?? OUTPUT_STYLE.any),
          keyValue('Blocked Terms', updated.negativeKeywords?.join(', ') ?? OUTPUT_STYLE.none),
          keyValue('Note', orNone(updated.targetNote))
        )
      ],
      flags: MessageFlags.Ephemeral
    });
  }
};
