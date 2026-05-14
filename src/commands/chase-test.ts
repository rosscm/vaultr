import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { keyValue, successEmbed } from '../ui/embeds.js';

export const chaseTest = {
  data: new SlashCommandBuilder().setName('chase-test').setDescription('Send a sample chase match alert'),
  async execute(interaction: any) {
    await interaction.reply({
      embeds: [
        successEmbed('🚨 Chase Match Found')
          .setDescription('**Umbreon VMAX Alt Art PSA 10**')
          .addFields(
            keyValue('💵 Price', '**$1140 CAD**'),
            keyValue('🌎 Region', '**CA**'),
            keyValue('🎯 Score', '**88**'),
            keyValue('🛒 Seller', '**High Reputation Seller**'),
            keyValue('🧠 Match Reasons', 'card name match, grade match, price within max')
          )
          .setFooter({ text: 'Vaultr • Collector Alert' })
      ],
      flags: MessageFlags.Ephemeral
    });
  }
};
