import { SlashCommandBuilder } from 'discord.js';
import { listChases, updateChase } from '../services/chase-store.js';

export const chaseEdit = {
  data: new SlashCommandBuilder()
    .setName('chase-edit')
    .setDescription('Edit an active chase by short id')
    .addStringOption((opt) => opt.setName('id').setDescription('Short id from /chase-list').setRequired(true))
    .addStringOption((opt) => opt.setName('card').setDescription('Updated card name'))
    .addNumberOption((opt) => opt.setName('max_price').setDescription('Updated max price'))
    .addStringOption((opt) => opt.setName('grade').setDescription('Updated grade preference (e.g. PSA 10)'))
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
    ),
  async execute(interaction: any) {
    const idPrefix = interaction.options.getString('id', true).trim();
    const chases = listChases(interaction.user.id);
    const match = chases.find((c) => c.id.startsWith(idPrefix));

    if (!match) {
      await interaction.reply(`No chase found with id prefix \`${idPrefix}\`.`);
      return;
    }

    const cardName = interaction.options.getString('card') ?? undefined;
    const maxPrice = interaction.options.getNumber('max_price') ?? undefined;
    const grade = interaction.options.getString('grade') ?? undefined;
    const condition = interaction.options.getString('condition') ?? undefined;
    const region = (interaction.options.getString('region') as 'CA' | 'US' | 'ANY' | null) ?? undefined;

    if (!cardName && maxPrice === undefined && !grade && !condition && !region) {
      await interaction.reply('No changes provided. Set at least one field to update.');
      return;
    }

    const updated = updateChase(interaction.user.id, match.id, {
      cardName,
      maxPrice,
      grade,
      condition,
      region
    });

    if (!updated) {
      await interaction.reply('Unable to update chase.');
      return;
    }

    await interaction.reply(
      `Updated chase: **${updated.cardName}** (id: \`${updated.id.slice(0, 8)}\`) | max: ${updated.maxPrice ?? 'any'} | grade: ${updated.grade ?? 'any'} | condition: ${updated.condition ?? 'any'} | region: ${updated.region ?? 'ANY'}`
    );
  }
};
