import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { setGuildCommandChannel } from '../services/chase-store.js';

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
      content: `Vaultr command channel set to <#${channel.id}>. Users must run Vaultr commands there.`,
      flags: MessageFlags.Ephemeral
    });
  }
};
