import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { getPollerState } from '../services/poller-state.js';
import { infoEmbed, keyValue } from '../ui/embeds.js';

export const status = {
  data: new SlashCommandBuilder().setName('status').setDescription('Show Vaultr runtime status'),
  async execute(interaction: any) {
    const state = getPollerState();
    await interaction.reply({
      embeds: [
        infoEmbed('Vaultr Runtime Status').addFields(
          keyValue('Source', state.sourceMode),
          keyValue('Poll Interval', `${state.pollIntervalSeconds}s`),
          keyValue('Last Run', state.lastRunAt ?? 'not yet'),
          keyValue('Matches (Last Run)', `${state.lastRunMatchesSent}`),
          keyValue('Matches (Total)', `${state.totalMatchesSent}`),
          keyValue('Last Error', state.lastError ?? 'none')
        )
      ],
      flags: MessageFlags.Ephemeral
    });
  }
};
