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
          keyValue('Last Completion', state.lastRunCompletedAt ?? 'not yet'),
          keyValue('Last Duration', state.lastRunDurationMs !== undefined ? `${state.lastRunDurationMs}ms` : 'n/a'),
          keyValue('Running', state.isRunning ? 'yes' : 'no'),
          keyValue('Matches (Last Run)', `${state.lastRunMatchesSent}`),
          keyValue('Matches (Total)', `${state.totalMatchesSent}`),
          keyValue('Consecutive Failures', `${state.consecutiveFailures}`),
          keyValue('Skipped Overlaps', `${state.skippedOverlappingRuns}`),
          keyValue('Last Error', state.lastError ?? 'none')
        )
      ],
      flags: MessageFlags.Ephemeral
    });
  }
};
