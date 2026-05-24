import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { listAllChases } from '../services/chase-store.js';
import { getPollerState } from '../services/poller-state.js';
import { infoEmbed, warningEmbed } from '../ui/embeds.js';
import { formatTimeWithAge } from '../ui/time.js';

export const health = {
  data: new SlashCommandBuilder()
    .setName('health')
    .setDescription('Owner: show Vaultr runtime health'),
  async execute(interaction: any) {
    const ownerId = process.env.OWNER_USER_ID;
    if (!ownerId || interaction.user.id !== ownerId) {
      await interaction.reply({
        embeds: [warningEmbed('Owner Only', 'This command is reserved for the Vaultr owner')],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const state = getPollerState();
    const duration = state.lastRunDurationMs === undefined ? 'n/a' : `${state.lastRunDurationMs}ms`;
    const nowMs = Date.now();
    const backoffUntilMs = state.backoffUntil ? new Date(state.backoffUntil).getTime() : undefined;
    const isBackoffActive = backoffUntilMs !== undefined && Number.isFinite(backoffUntilMs) && backoffUntilMs > nowMs;
    const lines = [
      `**Source:** ${state.sourceMode}`,
      `**Listing Check Cadence:** every ${state.pollIntervalSeconds}s`,
      `**Running:** ${state.isRunning ? 'Yes' : 'No'}`,
      `**Rate Limited / Backing Off:** ${isBackoffActive ? 'Yes' : 'No'}`,
      `**Active Chases:** ${listAllChases().length}`,
      `**Last Run:** ${formatTimeWithAge(state.lastRunAt)}`,
      `**Last Completion:** ${formatTimeWithAge(state.lastRunCompletedAt)}`,
      `**Last Duration:** ${duration}`,
      `**Source Calls (60s):** ${state.sourceCallsLastMinute}`,
      `**Rate Limit Skips:** ${state.rateLimitSkips}`,
      `**Consecutive Failures:** ${state.consecutiveFailures}`,
      `**Backoff Until:** ${state.backoffUntil ? formatTimeWithAge(state.backoffUntil) : 'None'}`,
      `**Last Source Success:** ${state.lastSourceSuccessAt ? formatTimeWithAge(state.lastSourceSuccessAt) : 'None'}`,
      `**Last Error:** ${state.lastError ?? 'None'}`
    ];

    await interaction.reply({
      embeds: [infoEmbed('🩺 Vaultr Health', lines.join('\n'))],
      flags: MessageFlags.Ephemeral
    });
  }
};
