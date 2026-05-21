import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { getGuildCommunityFeedMode, setGuildCommunityFeedMode } from '../services/chase-store.js';
import { errorEmbed, successEmbed } from '../ui/embeds.js';

export const communityFeed = {
  data: new SlashCommandBuilder()
    .setName('community-feed')
    .setDescription('Admin: set community feed mode for visible channel activity')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((opt) =>
      opt
        .setName('toggle')
        .setDescription('Posts brief status messages and daily stats to the setup channel (default: On)')
        .setRequired(true)
        .addChoices(
          { name: 'On', value: 'ON' },
          { name: 'Off', value: 'OFF' }
        )
    ),
  async execute(interaction: any) {
    if (!interaction.guildId) {
      await interaction.reply({ embeds: [errorEmbed('Server Only', 'This command can only be used in a server')], flags: MessageFlags.Ephemeral });
      return;
    }

    const toggle = interaction.options.getString('toggle', true);
    const nextMode = (toggle === 'OFF' ? 'OFF' : 'PULSE') as 'OFF' | 'PULSE';
    setGuildCommunityFeedMode(interaction.guildId, nextMode);
    const currentMode = getGuildCommunityFeedMode(interaction.guildId);
    const lines = [
      `**Community Feed:** ${currentMode === 'OFF' ? 'Off' : 'On'}`,
      '**Behavior:** posts brief status messages and daily stats to the setup channel'
    ];

    await interaction.reply({
      embeds: [
        successEmbed('Community Feed Updated', lines.join('\n')).setTitle('✅ Community Feed Updated')
      ],
      flags: MessageFlags.Ephemeral
    });
  }
};
