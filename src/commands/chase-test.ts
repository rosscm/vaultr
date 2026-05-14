import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { keyValue, successEmbed } from '../ui/embeds.js';

export const chaseTest = {
  data: new SlashCommandBuilder().setName('chase-test').setDescription('Send a sample chase match alert'),
  async execute(interaction: any) {
    await interaction.reply({
      embeds: [
        successEmbed('Chase Match Found')
          .setDescription('Umbreon VMAX Alt Art PSA 10')
          .addFields(
            keyValue('Price', '$1140 CAD'),
            keyValue('Seller Rating', 'High'),
            keyValue('Posted', '2m ago')
          )
      ],
      flags: MessageFlags.Ephemeral
    });
  }
};
