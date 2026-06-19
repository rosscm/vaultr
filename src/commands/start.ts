import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { infoEmbed } from '../ui/embeds.js';

export const start = {
  data: new SlashCommandBuilder()
    .setName('start')
    .setDescription('Open the Vaultr quick start'),
  async execute(interaction: any) {
    const lines = [
      '**Welcome to Vaultr!**',
      '',
      'Start with one card you want Vaultr to watch. Your chases shape better alerts now and help Vaultr learn what to show you next in your Weekly Shelf. 🔮',
      '',
      '**Step 1:** Add your first chase with `/chase add`; include the set number or variant when you know it',
      '**Step 2:** Tune confidence, currency, and source controls with `/alerts settings`',
      '**Step 3:** Watch DMs for chase alerts and check your server’s Vaultr channel for fresh collector picks in your Weekly Shelf',
      '**Step 4:** Use `/help` for the full command guide'
    ];

    await interaction.reply({
      embeds: [infoEmbed('🏁 Vaultr Quick Start', lines.join('\n'))],
      flags: MessageFlags.Ephemeral
    });
  }
};
