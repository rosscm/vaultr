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
    const region = (interaction.options.getString('region') as 'CA' | 'US' | 'ANY' | null) ?? 'ANY';

    const chase = addChase({
      userId: interaction.user.id,
      cardName,
      maxPrice,
      grade,
      region
    });

    await interaction.reply(`Added chase: **${chase.cardName}** (id: \`${chase.id.slice(0, 8)}\`)`);
  }
};
