import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { infoEmbed, keyValue } from '../ui/embeds.js';

export const help = {
  data: new SlashCommandBuilder().setName('help').setDescription('Show quick-start help and command guide'),
  async execute(interaction: any) {
    await interaction.reply({
      embeds: [
        infoEmbed(
          'Vaultr Help',
          'Start with `/chase-add`, then tune noise with `/alerts-settings`. Alerts are sent by DM when a listing matches.'
        ).addFields(
          keyValue(
            'Input Requirements',
            '`card` 3-100 chars | `max_price` > 0 | `grade` up to 24 chars | `priority` NORMAL/HIGH/GRAIL | `negative_keywords` CSV (max 15)'
          ),
          keyValue('Card Name Tip', 'Casing does not matter. For best matches, include card number and grade when relevant.'),
          keyValue('Chases', '`/chase-add` · `/chase-list` · `/chase-edit` · `/chase-remove`'),
          keyValue('Alerts', '`/alerts-settings` · `/alerts-settings-reset` · `/alerts-recent`'),
          keyValue('Plan', '`/plan` · `/upgrade`'),
          keyValue('Setup (Admin)', '`/setup-channel-set` · `/community-feed` · `/plan-set`'),
          keyValue('Diagnostics', '`/status` · `/chase-test`')
        )
      ],
      flags: MessageFlags.Ephemeral
    });
  }
};
