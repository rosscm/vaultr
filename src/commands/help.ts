import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { infoEmbed } from '../ui/embeds.js';

export const help = {
  data: new SlashCommandBuilder().setName('help').setDescription('Show the Vaultr command guide'),
  async execute(interaction: any) {
    const lines = [
      'Use this as your Vault map: every command, what it does, and where to go next. First time here? Get going with `/start`. 👋',
      '',
      '**/start**',
      '- Opens the first-run guide for getting your Vault set up',
      '',
      '**/chase**',
      '- Builds and manages the cards Vaultr watches for you',
      '- Use `add`, `list`, `edit`, and `remove` to keep the Vault focused',
      '- Better chase names include the card number, set, or variant when you know it',
      '',
      '**/alerts**',
      '- Controls the alert signal behind your Vault',
      '- Use `settings` for confidence, currency, volume, shipping, and sources',
      '- Use `status`, `recent`, and `preview` to inspect what Vaultr is watching and sending',
      '- Dial up confidence for fewer, cleaner alerts',
      '- Dial down confidence for more possible finds, with more noise',
      '',
      '**/plan**',
      '- Shows your current Free Vault or Full Vault access',
      '',
      '**/upgrade**',
      '- Explains what Vaultr Pro opens inside the Full Vault',
      '- Covers more chases, faster checks, trusted shops, custom exclusions, and deeper Weekly Shelf recommendations',
      '',
      '**/feed**',
      '- Admin: turn Community Vault Pulse posts on or off',
      '',
      '**/setup**',
      '- Admin: choose the server’s Vaultr channel',
      '- That channel is where Weekly Shelf posts and Vault Pulse activity can land',
      '',
      '**/help**',
      '- Shows this command guide when you need the full map again'
    ];

    await interaction.reply({
      embeds: [infoEmbed('🧭 Vaultr Command Guide', lines.join('\n')).setFooter({ text: 'Vaultr • Help' })],
      flags: MessageFlags.Ephemeral
    });
  }
};
