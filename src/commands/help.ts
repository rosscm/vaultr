import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { infoEmbed } from '../ui/embeds.js';

export const help = {
  data: new SlashCommandBuilder().setName('help').setDescription('Show the Vaultr quick start'),
  async execute(interaction: any) {
    const lines = [
      'Vaultr watches eBay for cards you care about and sends matching listings by DM',
      'Start with one specific chase; you can tune from there',
      '',
      '**First Steps**',
      '- Add a chase: `/chase add card:Pikachu 151 173`',
      '- Check what Vaultr is watching: `/alerts status`',
      '- Review matches already sent: `/alerts recent`',
      '',
      '**Good Chase Names**',
      '- Include the card number when you know it',
      '- Add a max price if you only want realistic listings',
      '- Keep names concrete: card, set, number, variant',
      '',
      '**Commands**',
      '- Vault: `/chase add` · `/chase list` · `/chase edit` · `/chase remove`',
      '- Alerts: `/alerts status` · `/alerts settings` · `/alerts recent`',
      '- Discovery: open the weekly server drop in-channel',
      '- Plan: `/plan view` · `/upgrade`',
      '',
      '**When It Feels Quiet**',
      '- Use `/alerts status` first',
      '- Quiet stretches are normal for precise chases',
      '- Broaden the chase or lower confidence in `/alerts settings` if needed',
      '',
      '**Free vs Pro**',
      '- Free keeps 3 active chases',
      '- Pro expands to 50, faster checks, deeper Discovery, and trusted shop sources'
    ];

    await interaction.reply({
      embeds: [infoEmbed('🧭 Vaultr Quick Start', lines.join('\n')).setFooter({ text: 'Vaultr • Help' })],
      flags: MessageFlags.Ephemeral
    });
  }
};
