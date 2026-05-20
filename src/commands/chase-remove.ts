import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { listChases, removeAllChases, removeChase } from '../services/chase-store.js';
import { errorEmbed, successEmbed, warningEmbed } from '../ui/embeds.js';

export const chaseRemove = {
  data: new SlashCommandBuilder()
    .setName('chase-remove')
    .setDescription('Remove one, many, or all active chases')
    .addIntegerOption((opt) =>
      opt.setName('entry').setDescription('Single entry number from /chase-list (optional; default: none)')
    )
    .addStringOption((opt) =>
      opt
        .setName('entries')
        .setDescription('Multiple entry numbers (comma-separated), e.g. 1,3,5 (optional; default: none)')
        .setMaxLength(120)
    )
    .addStringOption((opt) =>
      opt
        .setName('all')
        .setDescription('Remove all active chases (optional; default: No)')
        .addChoices(
          { name: 'No', value: 'NO' },
          { name: 'Yes, remove all', value: 'YES' }
        )
    ),
  async execute(interaction: any) {
    const all = interaction.options.getString('all');
    const singleEntry = interaction.options.getInteger('entry');
    const entriesCsv = interaction.options.getString('entries');
    const chases = listChases(interaction.user.id);

    if (chases.length === 0) {
      await interaction.reply({
        embeds: [errorEmbed('No Active Chases', 'There are no active chases to remove.')],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (all === 'YES') {
      const removedCount = removeAllChases(interaction.user.id);
      await interaction.reply({
        embeds: [successEmbed('All Chases Removed', `Removed ${removedCount} active chase(s).`).setTitle('✅ All Chases Removed')],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (all === 'NO' && singleEntry === null && entriesCsv === null) {
      await interaction.reply({
        embeds: [warningEmbed('No Targets Provided', 'Set `entry`, `entries`, or choose `all: Yes, remove all`.')],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const requestedEntries = new Set<number>();
    if (singleEntry !== null) requestedEntries.add(singleEntry);
    if (entriesCsv) {
      for (const token of entriesCsv.split(',')) {
        const n = Number(token.trim());
        if (Number.isInteger(n)) requestedEntries.add(n);
      }
    }

    if (requestedEntries.size === 0) {
      await interaction.reply({
        embeds: [warningEmbed('Invalid Entries', 'Use valid entry numbers, e.g. `entry: 2` or `entries: 1,3,5`.')],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const validEntries = [...requestedEntries].filter((entry) => entry >= 1 && entry <= chases.length);
    if (validEntries.length === 0) {
      await interaction.reply({
        embeds: [errorEmbed('Entry Not Found', 'No matching entries found. Use /chase-list first.')],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const targets = validEntries
      .map((entry) => ({ entry, chase: chases[entry - 1] }))
      .filter((x) => !!x.chase);

    let removedCount = 0;
    const removedLabels: string[] = [];
    for (const target of targets) {
      const removed = removeChase(interaction.user.id, target.chase.id);
      if (removed) {
        removedCount += 1;
        removedLabels.push(`#${target.entry} ${target.chase.cardName}`);
      }
    }

    if (removedCount === 0) {
      await interaction.reply({
        embeds: [errorEmbed('Remove Failed', 'No chases were removed.')],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    await interaction.reply({
      embeds: [
        successEmbed(
          'Chases Removed',
          `Removed ${removedCount} chase(s):\n${removedLabels.map((label) => `- ${label}`).join('\n')}`
        ).setTitle('✅ Chases Removed')
      ],
      flags: MessageFlags.Ephemeral
    });
  }
};
