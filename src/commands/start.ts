import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { infoEmbed } from '../ui/embeds.js';

export const start = {
  data: new SlashCommandBuilder()
    .setName('start')
    .setDescription('Open the KeepSeek quick start'),
  async execute(interaction: any) {
    const lines = [
      '**Welcome to KeepSeek!** 👋',
      '',
      'Start with one card you actually want to know about. Specific chases make cleaner alerts and teach KeepSeek the tiny details that make a grail feel personal.',
      'Your best first move is to open `/chase add` and start typing one specific card.',
      'Every Monday, your setup channel gets a fresh set of collector picks. KeepSeek Plus adds a personalized Display Case shaped by your collection and feedback.',
      '',
      '**Step 1:** Add your first chase with `/chase add`',
      'Start typing `Mew RC24` if you want an easy first test, then pick the match if it looks right.',
      'If your card does not show up, you can still enter it yourself.',
      '**Step 2:** Check your active Watchlist with `/chase list`',
      '**Step 3:** Tune confidence, currency, shipping, and sources with `/alerts settings`',
      '**Step 4:** Watch DMs for chase alerts',
      '**Step 5:** Use `/help` when you want the full command map',
      '',
      'Keep what you love. Seek what comes next.'
    ];

    await interaction.reply({
      embeds: [infoEmbed('🏁 KeepSeek Quick Start', lines.join('\n'))],
      flags: MessageFlags.Ephemeral
    });
  }
};
