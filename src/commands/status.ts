import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { getUserAlertSettings } from '../services/chase-store.js';
import { getPollerState } from '../services/poller-state.js';
import { infoEmbed } from '../ui/embeds.js';
import { formatTimeWithAge } from '../ui/time.js';
import { OUTPUT_STYLE } from '../ui/style.js';

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
          {
            name: 'Runtime',
            value: [
              `Source: ${state.sourceMode}`,
              `Poll Interval: ${state.pollIntervalSeconds}s`,
              `Running: ${state.isRunning ? OUTPUT_STYLE.yes : OUTPUT_STYLE.no}`,
              `Last Run: ${formatTimeWithAge(state.lastRunAt)}`,
              `Last Completion: ${formatTimeWithAge(state.lastRunCompletedAt)}`,
              `Last Duration: ${state.lastRunDurationMs !== undefined ? `${state.lastRunDurationMs}ms` : 'n/a'}`
            ].join('\n'),
            inline: false
          },
          {
            name: 'Throughput',
            value: [
              `Matches (Last Run): ${state.lastRunMatchesSent}`,
              `Matches (Total): ${state.totalMatchesSent}`,
              `Source Calls (60s): ${state.sourceCallsLastMinute}`,
              `Rate Limit Skips: ${state.rateLimitSkips}`
            ].join('\n'),
            inline: false
          },
          {
            name: 'Suppression',
            value: [
              `Alert Currency: ${settings.alertCurrency}`,
              `Min Score: ${state.suppressedByMinScore}`,
              `Cooldown: ${state.suppressedByChaseCooldown}`,
              `Dupes: ${state.suppressedByFingerprint}`
            ].join('\n'),
            inline: false
          },
          {
            name: 'Health',
            value: [
              `Consecutive Failures: ${state.consecutiveFailures}`,
              `Skipped Overlaps: ${state.skippedOverlappingRuns}`,
              `Backoff Until: ${state.backoffUntil ? formatTimeWithAge(state.backoffUntil) : OUTPUT_STYLE.none}`,
              `Last Source Success: ${formatTimeWithAge(state.lastSourceSuccessAt)}`,
              `Last Error: ${state.lastError ?? OUTPUT_STYLE.none}`
            ].join('\n'),
            inline: false
          },
          {
            name: 'Hint',
            value: hint,
            inline: false
          }
        )
      ],
      flags: MessageFlags.Ephemeral
    });
  }
};
