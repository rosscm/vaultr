import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { infoEmbed } from '../ui/embeds.js';

export const chaseTest = {
  data: new SlashCommandBuilder().setName('chase-test').setDescription('Send a sample chase match alert'),
  async execute(interaction: any) {
    const lines = [
      '**Title:** Umbreon VMAX Alt Art PSA 10',
      '**Confidence:** High',
      '**Price vs Max:** Under by 60',
      '**Posted:** 2m ago',
      '**Price:** 1140 CAD',
      '**Shipping:** 15 CAD',
      '**Seller:** High Reputation Seller',
      '**Seller Feedback:** 99.8% (4231)',
      '**Why It Matched:** exact card name match, grade match, within your max'
    ];

    await interaction.reply({
      embeds: [
        infoEmbed('🧪 Chase Alert Preview', lines.join('\n')).setFooter({ text: 'Vaultr • Collector Alert' })
      ],
      flags: MessageFlags.Ephemeral
    });
  }
};
