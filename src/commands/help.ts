import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { infoEmbed } from '../ui/embeds.js';

export const help = {
  data: new SlashCommandBuilder().setName('help').setDescription('Show the KeepSeek command guide'),
  async execute(interaction: any) {
    const lines = [
      'Use this as your command map. First time here? Start with `/start`, then add one specific card chase.',
      '',
      '✨ **Start Watching**',
      '- `/start` opens the first-run guide',
      '- `/chase add` adds a card for KeepSeek to watch',
      '- Start typing your chase and pick the autocomplete match if it looks right',
      '- If your card does not appear, you can still enter it yourself',
      '- `/chase list` shows active and paused chases',
      '- One specific chase is better than three broad ones when you are getting started',
      '- Strong chase names include the card number, set, language, or variant when you know it',
      '',
      '🗂️ **Refine Your Watchlist**',
      '- `/chase edit` tightens a chase name, max price, grade, condition, priority, note, or exclusions',
      '- `/chase remove` clears cards you no longer want watched',
      '',
      '🎚️ **Tune Alerts**',
      '- `/alerts settings` controls confidence, currency, volume, shipping, and sources',
      '- `/alerts status` shows the current alert setup',
      '- `/alerts recent` reviews recent alerts',
      '- `/alerts test` checks whether KeepSeek can reach your DMs',
      '- `/alerts preview` checks how a listing would read before it sends',
      '- Dial up confidence for fewer, cleaner alerts',
      '- Dial down confidence for more possible finds, with more noise',
      '',
      '🔮 **Discover More**',
      '- Display Case picks arrive in the setup channel when the weekly drop is live',
      '- `/plan` shows current Free or KeepSeek Plus access',
      '- `/upgrade` explains what KeepSeek Plus adds',
      '',
      '☕ **Server Rhythm**',
      '- `/setup channel` lets admins choose where KeepSeek posts server moments',
      '- `/feed` lets admins turn Community Pulse posts on or off',
      '- Community Pulse can post on quiet days so active chases do not look abandoned',
      '',
      '🌙 **When It Feels Quiet**',
      '- Quiet days are normal. KeepSeek sends alerts only when a listing clears your match settings',
      '- `/alerts status` shows whether your Watchlist is active between matches'
    ];

    await interaction.reply({
      embeds: [infoEmbed('🧭 KeepSeek Command Guide', lines.join('\n')).setFooter({ text: 'KeepSeek • Help' })],
      flags: MessageFlags.Ephemeral
    });
  }
};
