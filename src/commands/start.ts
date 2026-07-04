import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { infoEmbed } from '../ui/embeds.js';

export const start = {
  data: new SlashCommandBuilder()
    .setName('start')
    .setDescription('Open the Vaultr quick start'),
  async execute(interaction: any) {
    const lines = [
      '**Welcome to Vaultr!** 👋',
      '',
      'Start with one card you actually want to know about. Specific chases make cleaner alerts and teach Vaultr the tiny details that make a grail feel personal.',
      'Your best first move is to open `/chase add` and start typing one specific card.',
      'Every Monday, your setup channel gets a fresh shelf of collector picks shaped by your Vault and taste signals.',
      '',
      '**Step 1:** Add your first chase with `/chase add`',
      'Start typing `Mew RC24` if you want an easy first test, then pick the match if it looks right.',
      'If your card does not show up, you can still enter it yourself.',
      '**Step 2:** Check your active Vault with `/chase list`',
      '**Step 3:** Tune confidence, currency, shipping, and sources with `/alerts settings`',
      '**Step 4:** Watch DMs for chase alerts',
      '**Step 5:** Use `/help` when you want the full command map',
      '',
      'Build your Vault. Chase your grails. Discover what you love next.'
    ];

    await interaction.reply({
      embeds: [infoEmbed('🏁 Vaultr Quick Start', lines.join('\n'))],
      flags: MessageFlags.Ephemeral
    });
  }
};
