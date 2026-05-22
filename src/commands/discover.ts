import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { infoEmbed } from '../ui/embeds.js';

export const discover = {
  data: new SlashCommandBuilder()
    .setName('discover')
    .setDescription('Get collector-focused discovery suggestions')
    .addStringOption((opt) =>
      opt
        .setName('query')
        .setDescription('Optional focus, e.g. umbreon or artist:kanda')
        .setMaxLength(80)
    ),
  async execute(interaction: any) {
    const query = interaction.options.getString('query');
    const title = query ? `Discover · ${query}` : 'Discover';
    const lines = [
      '**Discovery is warming up**',
      'The personalized taste engine is coming soon',
      '',
      '**Next:** Keep adding chases so Vaultr can learn your collector style'
    ];

    await interaction.reply({
      embeds: [infoEmbed(`✨ ${title}`, lines.join('\n'))],
      flags: MessageFlags.Ephemeral
    });
  }
};

