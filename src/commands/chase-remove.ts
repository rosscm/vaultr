import { SlashCommandBuilder } from 'discord.js';
import { listChases, removeChase } from '../services/chase-store.js';

export const chaseRemove = {
  data: new SlashCommandBuilder()
    .setName('chase-remove')
    .setDescription('Remove an active chase by short id')
    .addStringOption((opt) => opt.setName('id').setDescription('Short id from /chase-list').setRequired(true)),
  async execute(interaction: any) {
    const idPrefix = interaction.options.getString('id', true).trim();
    const chases = listChases(interaction.user.id);
    const match = chases.find((c) => c.id.startsWith(idPrefix));

    if (!match) {
      await interaction.reply(`No chase found with id prefix \`${idPrefix}\`.`);
      return;
    }

    const removed = removeChase(interaction.user.id, match.id);
    await interaction.reply(removed ? `Removed chase: **${match.cardName}**` : 'Unable to remove chase.');
  }
};
