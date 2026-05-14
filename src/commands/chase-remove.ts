import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { listChases, removeChase } from '../services/chase-store.js';

export const chaseRemove = {
  data: new SlashCommandBuilder()
    .setName('chase-remove')
    .setDescription('Remove an active chase by list entry number')
    .addIntegerOption((opt) => opt.setName('entry').setDescription('Entry number from /chase-list').setRequired(true)),
  async execute(interaction: any) {
    const entry = interaction.options.getInteger('entry', true);
    const chases = listChases(interaction.user.id);
    const match = chases[entry - 1];

    if (!match) {
      await interaction.reply({ content: `No chase found at entry \`${entry}\`. Use /chase-list first.`, flags: MessageFlags.Ephemeral });
      return;
    }

    const removed = removeChase(interaction.user.id, match.id);
    await interaction.reply({
      content: removed ? `Removed chase #${entry}: **${match.cardName}**` : 'Unable to remove chase.',
      flags: MessageFlags.Ephemeral
    });
  }
};
