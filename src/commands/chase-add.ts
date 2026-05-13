import { SlashCommandBuilder } from 'discord.js';
import { addChase } from '../services/chase-store.js';

export const chaseAdd = {
  data: new SlashCommandBuilder()
    .setName('chase-add')
    .setDescription('Add a new chase card')
    .addStringOption((opt) => opt.setName('card').setDescription('Card name').setRequired(true))
    .addNumberOption((opt) => opt.setName('max_price').setDescription('Max price'))
    .addStringOption((opt) => opt.setName('grade').setDescription('Grade preference (e.g. PSA 10)'))
    .addStringOption((opt) =>
      opt
        .setName('condition')
        .setDescription('Condition preference')
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
        .setDescription('Seller region')
        .addChoices(
          { name: 'Any', value: 'ANY' },
          { name: 'Canada', value: 'CA' },
          { name: 'United States', value: 'US' }
        )
    ),
  async execute(interaction: any) {
    const cardName = interaction.options.getString('card', true);
    const maxPrice = interaction.options.getNumber('max_price') ?? undefined;
    const grade = interaction.options.getString('grade') ?? undefined;
    const condition = interaction.options.getString('condition') ?? undefined;
    const region = (interaction.options.getString('region') as 'CA' | 'US' | 'ANY' | null) ?? 'ANY';

    const chase = addChase({
      userId: interaction.user.id,
      guildId: interaction.guildId ?? undefined,
      cardName,
      maxPrice,
      grade,
      condition,
      region
    });

    await interaction.reply(
      `Added chase: **${chase.cardName}** (id: \`${chase.id.slice(0, 8)}\`) | max: ${chase.maxPrice ?? 'any'} | grade: ${chase.grade ?? 'any'} | condition: ${chase.condition ?? 'any'} | region: ${chase.region ?? 'ANY'}`
    );
  }
};
