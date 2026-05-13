import { SlashCommandBuilder } from 'discord.js';
import { listChases, removeChase } from '../services/chase-store.js';

export const chaseRemoveLatest = {
  data: new SlashCommandBuilder()
    .setName('chase-remove-latest')
    .setDescription('Remove your most recently created chase'),
  async execute(interaction: any) {
    const latest = listChases(interaction.user.id)[0];
    if (!latest) {
      await interaction.reply('No active chases found. Use /chase-add first.');
      return;
    }

    const removed = removeChase(interaction.user.id, latest.id);
    await interaction.reply(removed ? `Removed latest chase: **${latest.cardName}**` : 'Unable to remove chase.');
  }
};
