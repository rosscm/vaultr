import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { setGuildAlertChannel } from '../services/chase-store.js';

export const alertsChannelSet = {
  data: new SlashCommandBuilder()
    .setName('alerts-channel-set')
    .setDescription('Set the channel where Vaultr posts chase alerts for this server')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption((opt) =>
      opt
        .setName('channel')
        .setDescription('Target text channel for alerts')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    ),
  async execute(interaction: any) {
    if (!interaction.guildId) {
      await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
      return;
    }

    const channel = interaction.options.getChannel('channel', true);
    setGuildAlertChannel(interaction.guildId, channel.id);

    await interaction.reply(`Alerts channel set to <#${channel.id}> for this server.`);
  }
};
