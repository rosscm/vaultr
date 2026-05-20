import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { setGuildCommandChannel } from '../services/chase-store.js';
import { keyValue, successEmbed } from '../ui/embeds.js';

export const setupChannelSet = {
  data: new SlashCommandBuilder()
    .setName('setup-channel-set')
    .setDescription('Admin: set the dedicated channel where Vaultr commands can be used')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption((opt) =>
      opt
        .setName('channel')
        .setDescription('Dedicated Vaultr commands channel')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    ),
  async execute(interaction: any) {
    if (!interaction.guildId) {
      await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
      return;
    }

    const channel = interaction.options.getChannel('channel', true);
    setGuildCommandChannel(interaction.guildId, channel.id);

    await interaction.reply({
      embeds: [
        successEmbed('Command Channel Updated', `Vaultr commands are now pinned to <#${channel.id}>.`).addFields(
          keyValue('Quickstart', '1) `/alerts-settings-reset`  2) `/chase-add`  3) `/status`')
        )
      ],
      flags: MessageFlags.Ephemeral
    });
  }
};
