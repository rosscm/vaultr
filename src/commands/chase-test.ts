import { MessageFlags, SlashCommandBuilder } from 'discord.js';

export const chaseTest = {
  data: new SlashCommandBuilder().setName('chase-test').setDescription('Send a sample chase match alert'),
  async execute(interaction: any) {
    await interaction.reply({
      content: '🚨 **Chase Match Found**\nUmbreon VMAX Alt Art PSA 10\n$1140 CAD\nSeller Rating: High\nPosted: 2m ago',
      flags: MessageFlags.Ephemeral
    });
  }
};
