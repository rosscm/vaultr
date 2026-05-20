import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { infoEmbed } from '../ui/embeds.js';

export const chaseTest = {
  data: new SlashCommandBuilder().setName('chase-test').setDescription('Send a sample chase match alert'),
  async execute(interaction: any) {
    await interaction.reply({
      embeds: [
        infoEmbed('Chase Alert Preview')
          .setDescription('**Umbreon VMAX Alt Art PSA 10**\nHigh Confidence • Under max by 60 • Posted 2m ago')
          .addFields({
            name: 'Preview',
            value: [
              'Price: 1140 CAD',
              'Shipping: 15 CAD',
              'Seller: High Reputation Seller',
              'Seller Feedback: 99.8% (4231)',
              'Why It Matched: exact card name match, grade match, within your max'
            ].join('\n'),
            inline: false
          })
          .setFooter({ text: 'Vaultr • Collector Alert' })
      ],
      flags: MessageFlags.Ephemeral
    });
  }
};
