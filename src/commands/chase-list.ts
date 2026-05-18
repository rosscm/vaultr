import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { listChases } from '../services/chase-store.js';
import { infoEmbed, keyValue } from '../ui/embeds.js';

export const chaseList = {
  data: new SlashCommandBuilder().setName('chase-list').setDescription('List your active chases'),
  async execute(interaction: any) {
    const chases = listChases(interaction.user.id);
    if (chases.length === 0) {
      await interaction.reply({
        embeds: [infoEmbed('No Active Chases', 'Use `/chase-add` to start one.')],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const lines = chases.map((c, i) => {
      const header = `**#${i + 1} — ${c.cardName}**`;
      const details = [
        `**Max:** ${c.maxPrice ?? 'any'}`,
        `**Grade:** ${c.grade ?? 'any'}`,
        `**Condition:** ${c.condition ?? 'any'}`,
        `**Region:** ${c.region ?? 'ANY'}`,
        `**Listing:** ${c.listingType ?? 'ANY'}`,
        `**Blocked:** ${c.negativeKeywords?.join(', ') ?? 'none'}`
      ].join(' | ');
      return `${header}\n${details}`;
    });

    const summary = `**Total Active Chases:** ${chases.length}`;
    await interaction.reply({
      embeds: [
        infoEmbed('Your Chases', `${summary}\n\n${lines.join('\n\n---\n\n')}`).addFields(
          keyValue('Tip', 'Use `/chase-edit entry:<n>` or `/chase-remove entry:<n>`')
        )
      ],
      flags: MessageFlags.Ephemeral
    });
  }
};
