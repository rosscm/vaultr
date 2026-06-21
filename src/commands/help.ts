import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { infoEmbed } from '../ui/embeds.js';

export const help = {
  data: new SlashCommandBuilder().setName('help').setDescription('Show the Vaultr command guide'),
  async execute(interaction: any) {
    const lines = [
      'Use this as your Vault map. First time here? Start with `/start` and one specific card chase.',
      '',
      '✨ **Start Watching**',
      '- `/start` opens the first-run guide',
      '- `/chase add` adds a card for Vaultr to watch',
      '- `/chase list` shows active and paused chases',
      '- Strong chase names include the card number, set, language, or variant when you know it',
      '',
      '🗂️ **Refine The Vault**',
      '- `/chase edit` tightens a chase name, max price, grade, condition, priority, note, or exclusions',
      '- `/chase remove` clears cards you no longer want watched',
      '',
      '🎚️ **Tune Alerts**',
      '- `/alerts settings` controls confidence, currency, volume, shipping, and sources',
      '- `/alerts status` shows the current alert setup',
      '- `/alerts recent` reviews recent alerts',
      '- `/alerts preview` checks how a listing would read before it sends',
      '- Dial up confidence for fewer, cleaner alerts',
      '- Dial down confidence for more possible finds, with more noise',
      '',
      '🔮 **Discover More**',
      '- Weekly Shelf arrives in the setup channel when the weekly drop is live',
      '- `/plan` shows current Free Vault or Full Vault access',
      '- `/upgrade` explains what Vaultr Pro opens inside the Full Vault',
      '',
      '☕ **Server Rhythm**',
      '- `/setup channel` lets admins choose where Vaultr posts server moments',
      '- `/feed` lets admins turn Community Vault Pulse posts on or off',
      '- Vault Pulse can post on quiet days so active chases do not look abandoned',
      '',
      '🌙 **When It Feels Quiet**',
      '- Quiet days are normal. Vaultr sends chase alerts only when a listing clears your match settings'
    ];

    await interaction.reply({
      embeds: [infoEmbed('🧭 Vaultr Command Guide', lines.join('\n')).setFooter({ text: 'Vaultr • Help' })],
      flags: MessageFlags.Ephemeral
    });
  }
};
