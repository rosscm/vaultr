import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { isGuildCommunityFeedEnabled, setGuildCommunityFeedEnabled } from '../services/chase-store.js';
import { successEmbed } from '../ui/embeds.js';
import { OUTPUT_STYLE } from '../ui/style.js';

export const communityFeed = {
  data: new SlashCommandBuilder()
    .setName('community-feed')
    .setDescription('Admin: enable or disable lightweight community activity posts')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((opt) =>
      opt
        .setName('mode')
        .setDescription('Enable or disable')
        .setRequired(true)
        .addChoices(
          { name: 'On', value: 'ON' },
          { name: 'Off', value: 'OFF' }
        )
    ),
  async execute(interaction: any) {
    if (!interaction.guildId) {
      await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
      return;
    }

    const mode = interaction.options.getString('mode', true);
    const enabled = mode === 'ON';
    setGuildCommunityFeedEnabled(interaction.guildId, enabled);
    const currentState = isGuildCommunityFeedEnabled(interaction.guildId) ? OUTPUT_STYLE.on : OUTPUT_STYLE.off;
    const lines = [
      `**Mode:** ${enabled ? OUTPUT_STYLE.on : OUTPUT_STYLE.off}`,
      `**Current State:** ${currentState}`
    ];

    await interaction.reply({
      embeds: [
        successEmbed('Community Feed Updated', lines.join('\n')).setTitle('✅ Community Feed Updated')
      ],
      flags: MessageFlags.Ephemeral
    });
  }
};
