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
      'Start with one card you actually want to know about. Specific chases make cleaner alerts and teach Vaultr what belongs in your Weekly Shelf.',
      '',
      '**Good first chases:**',
      '- `Umbreon 217/187 Japanese`',
      '- `Mew RC24/RC25`',
      '- `Gardevoir ex Paldean Fates 233`',
      '',
      '**Step 1:** Add your first chase with `/chase add`',
      '**Step 2:** Check your active Vault with `/chase list`',
      '**Step 3:** Tune confidence, currency, shipping, and sources with `/alerts settings`',
      '**Step 4:** Watch DMs for chase alerts; quiet days are normal when no listing clears your match settings',
      '**Step 5:** Use `/help` when you want the full command map'
    ];

    await interaction.reply({
      embeds: [infoEmbed('🏁 Vaultr Quick Start', lines.join('\n'))],
      flags: MessageFlags.Ephemeral
    });
  }
};
