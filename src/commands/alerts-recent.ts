import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { listRecentAlerts } from '../services/chase-store.js';
import { infoEmbed } from '../ui/embeds.js';

export const alertsRecent = {
  data: new SlashCommandBuilder()
    .setName('alerts-recent')
    .setDescription('Show your recent delivered alerts')
    .addIntegerOption((opt) =>
      opt
        .setName('limit')
        .setDescription('How many alerts to show (max 20)')
        .setMinValue(1)
        .setMaxValue(20)
    ),
  async execute(interaction: any) {
    const limit = interaction.options.getInteger('limit') ?? 10;
    const recent = listRecentAlerts(interaction.user.id, limit);

    if (recent.length === 0) {
      await interaction.reply({
        embeds: [infoEmbed('Recent Alerts', 'No delivered alerts yet.')],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const lines = recent.map((a, i) => {
      const title = a.listingTitle ?? a.listingId;
      const price = a.listingPrice !== undefined ? `${a.listingPrice} ${a.listingCurrency ?? ''}`.trim() : 'n/a';
      const score = a.matchScore ?? 'n/a';
      return `**${i + 1}. ${title}**\n**Price:** ${price} | **Score:** ${score}\n**Sent:** ${a.sentAt}`;
    });

    await interaction.reply({
      embeds: [infoEmbed('Recent Alerts', lines.join('\n\n---\n\n'))],
      flags: MessageFlags.Ephemeral
    });
  }
};
