import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { setGuildCommandChannel } from '../services/chase-store.js';
import { errorEmbed, successEmbed, warningEmbed } from '../ui/embeds.js';

export const setupChannelSet = {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Admin: choose where Vaultr lives in this server')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName('channel')
        .setDescription('Set the channel where Vaultr commands belong')
        .addChannelOption((opt) =>
          opt
            .setName('channel')
            .setDescription('Channel for Vaultr commands and community pulse')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    ),
  async execute(interaction: any) {
    if (!interaction.guildId) {
      await interaction.reply({ embeds: [errorEmbed('Server Only', 'This command can only be used in a server.')], flags: MessageFlags.Ephemeral });
      return;
    }

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({
        embeds: [warningEmbed('Admin Only', 'This subcommand requires Manage Server permissions')],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const channel = interaction.options.getChannel('channel', true);
    setGuildCommandChannel(interaction.guildId, channel.id);
    const lines = [
      `**Channel:** <#${channel.id}>`,
      '**Quickstart:** 1) /alerts settings  2) /chase add  3) /help'
    ];

    await interaction.reply({
      embeds: [successEmbed('Command Channel Updated', lines.join('\n')).setTitle('✅ Command Channel Updated')],
      flags: MessageFlags.Ephemeral
    });
  }
};
