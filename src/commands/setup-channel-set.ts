import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { getGuildCommunityFeedMode, setGuildCommandChannel, type CommunityFeedMode } from '../services/chase-store.js';
import { errorEmbed, successEmbed, warningEmbed } from '../ui/embeds.js';

const REQUIRED_SETUP_CHANNEL_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks
] as const;

const SETUP_CHANNEL_PERMISSION_LABELS = new Map<bigint, string>([
  [PermissionFlagsBits.ViewChannel, 'View Channel'],
  [PermissionFlagsBits.SendMessages, 'Send Messages'],
  [PermissionFlagsBits.EmbedLinks, 'Embed Links']
]);

export function missingSetupChannelPermissions(channel: any, botMember: any): string[] {
  const permissions = channel?.permissionsFor?.(botMember);
  if (!permissions) {
    return REQUIRED_SETUP_CHANNEL_PERMISSIONS.map((permission) => SETUP_CHANNEL_PERMISSION_LABELS.get(permission) ?? String(permission));
  }

  return REQUIRED_SETUP_CHANNEL_PERMISSIONS
    .filter((permission) => !permissions.has(permission))
    .map((permission) => SETUP_CHANNEL_PERMISSION_LABELS.get(permission) ?? String(permission));
}

function communityVaultPulseSetupLine(mode: CommunityFeedMode): string {
  if (mode === 'OFF') {
    return 'Community Vault Pulse: Off — use `/feed toggle:On` to enable community posts.';
  }

  return 'Community Vault Pulse: On — use `/feed toggle:Off` to disable community posts.';
}

export const setupChannelSet = {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Admin: choose the Vaultr server channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName('channel')
        .setDescription('Set the Vaultr command channel')
        .addChannelOption((opt) =>
          opt
            .setName('channel')
            .setDescription('Channel for commands and Vault Pulse')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    ),
  async execute(interaction: any) {
    if (!interaction.guildId) {
      await interaction.reply({ embeds: [errorEmbed('Server Only', 'This command can only be used in a server')], flags: MessageFlags.Ephemeral });
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
    const botMember = interaction.guild?.members?.me ?? interaction.client?.user?.id;
    const missingPermissions = missingSetupChannelPermissions(channel, botMember);
    if (missingPermissions.length > 0) {
      await interaction.reply({
        embeds: [
          warningEmbed(
            'Channel Permissions Required',
            [
              `Vaultr cannot use <#${channel.id}> yet.`,
              '',
              `**Missing:** ${missingPermissions.join(', ')}`,
              'Update Vaultr channel or role permissions, then retry `/setup channel`.'
            ].join('\n')
          )
        ],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    setGuildCommandChannel(interaction.guildId, channel.id);
    const communityFeedMode = getGuildCommunityFeedMode(interaction.guildId);
    const lines = [
      `**Channel:** <#${channel.id}>`,
      '**Quickstart:** 1) `/start`  2) `/chase add`  3) peek inside Weekly Discovery drops here',
      communityVaultPulseSetupLine(communityFeedMode)
    ];

    await interaction.reply({
      embeds: [successEmbed('Command Channel Updated', lines.join('\n')).setTitle('✅ Command Channel Updated')],
      flags: MessageFlags.Ephemeral
    });
  }
};
