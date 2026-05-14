import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { listChases, removeChase } from '../services/chase-store.js';
import { errorEmbed, successEmbed } from '../ui/embeds.js';

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
      await interaction.reply({
        embeds: [errorEmbed('Entry Not Found', `No chase found at entry \`${entry}\`. Use /chase-list first.`)],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const removed = removeChase(interaction.user.id, match.id);
    await interaction.reply({
      embeds: [removed ? successEmbed('Chase Removed', `Removed chase #${entry}: **${match.cardName}**`) : errorEmbed('Remove Failed', 'Unable to remove chase.')],
      flags: MessageFlags.Ephemeral
    });
  }
};
