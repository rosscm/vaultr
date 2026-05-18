import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { getUserAlertSettings } from '../services/chase-store.js';
import { getPollerState } from '../services/poller-state.js';
import { infoEmbed, keyValue } from '../ui/embeds.js';

export const status = {
  data: new SlashCommandBuilder().setName('status').setDescription('Show Vaultr runtime status'),
  async execute(interaction: any) {
    const state = getPollerState();
    const settings = getUserAlertSettings(interaction.user.id);
    let hint = 'No immediate issues detected.';
    if (state.lastRunMatchesSent === 0) {
      hint = `No matches last run. If you expect alerts, try lowering min_score (current ${settings.minScore}) or broadening chase filters.`;
    }
    if (state.consecutiveFailures > 0) {
      hint = `Source reliability issue detected (${state.consecutiveFailures} consecutive failures).`;
    }
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
          keyValue('Last Error', state.lastError ?? 'none'),
          keyValue('Hint', hint)
        )
      ],
      flags: MessageFlags.Ephemeral
    });
  }
};
