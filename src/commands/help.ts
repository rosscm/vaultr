import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { infoEmbed } from '../ui/embeds.js';
import { FULL_VAULT_SUMMARY } from './pro-copy.js';

export const help = {
  data: new SlashCommandBuilder().setName('help').setDescription('Show the Vaultr quick start'),
  async execute(interaction: any) {
    const lines = [
      'Vaultr keeps watch for the cards you care about and sends matching listings by DM',
      'Start with one specific chase. The Vault gets sharper from there',
      '',
      '**First Steps**',
      '- Add a chase: `/chase add card:Pikachu 151 173`',
      '- Check what Vaultr is watching: `/alerts status`',
      '- Review matches already sent: `/alerts recent`',
      '',
      '**Good Chase Names**',
      '- Include the card number when you know it',
      '- Add a max price if you only want realistic listings',
      '- Keep names concrete: card, set, number, variant, or promo stamp',
      '',
      '**Commands**',
      '- Vault: `/chase add` · `/chase list` · `/chase edit` · `/chase remove`',
      '- Alerts: `/alerts status` · `/alerts settings` · `/alerts recent`',
      '- Discovery: peek inside the weekly server drop for your private shelf',
      '- Plan: `/plan view` · `/upgrade`',
      '',
      '**When It Feels Quiet**',
      '- Use `/alerts status` first',
      '- Quiet stretches are normal for precise grails',
      '- Broaden the chase or lower confidence in `/alerts settings` if needed',
      '',
      '**Free Vault vs Full Vault**',
      '- Free Vault keeps 3 active chases',
      `- Full Vault: ${FULL_VAULT_SUMMARY}`
    ];

    await interaction.reply({
      embeds: [infoEmbed('🧭 Vaultr Quick Start', lines.join('\n')).setFooter({ text: 'Vaultr • Help' })],
      flags: MessageFlags.Ephemeral
    });
  }
};
