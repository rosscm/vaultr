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
