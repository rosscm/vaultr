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
        .setName('mode')
        .setDescription('Feed mode (default: PULSE)')
        .setRequired(true)
        .addChoices(
          { name: 'Pulse (recommended)', value: 'PULSE' },
          { name: 'Milestones', value: 'MILESTONES' },
          { name: 'Off', value: 'OFF' }
        )
    ),
  async execute(interaction: any) {
    if (!interaction.guildId) {
      await interaction.reply({ embeds: [errorEmbed('Server Only', 'This command can only be used in a server')], flags: MessageFlags.Ephemeral });
      return;
    }

    const mode = interaction.options.getString('mode', true);
    const nextMode = (mode === 'MILESTONES' || mode === 'OFF' ? mode : 'PULSE') as 'OFF' | 'PULSE' | 'MILESTONES';
    setGuildCommunityFeedMode(interaction.guildId, nextMode);
    const currentMode = getGuildCommunityFeedMode(interaction.guildId);
    const lines = [
      `**Mode:** ${currentMode}`,
      '**Behavior:** first-hunter milestone posts only (no per-chase spam)'
    ];

    await interaction.reply({
      embeds: [
        successEmbed('Community Feed Updated', lines.join('\n')).setTitle('✅ Community Feed Updated')
      ],
      flags: MessageFlags.Ephemeral
    });
  }
};
