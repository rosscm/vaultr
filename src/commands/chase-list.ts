import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { listChases } from '../services/chase-store.js';

export const chaseList = {
  data: new SlashCommandBuilder().setName('chase-list').setDescription('List your active chases'),
  async execute(interaction: any) {
    const chases = listChases(interaction.user.id);
    if (chases.length === 0) {
      await interaction.reply({ content: 'No active chases yet. Use `/chase-add` to start one.', flags: MessageFlags.Ephemeral });
      return;
    }

    const lines = chases.map(
      (c, i) =>
        `${i + 1}. ${c.cardName} | max: ${c.maxPrice ?? 'any'} | grade: ${c.grade ?? 'any'} | condition: ${c.condition ?? 'any'} | region: ${c.region ?? 'ANY'} | blocked: ${c.negativeKeywords?.join(', ') ?? 'none'}`
    );
    await interaction.reply({ content: `Your chases:\n${lines.join('\n')}`, flags: MessageFlags.Ephemeral });
  }
};
