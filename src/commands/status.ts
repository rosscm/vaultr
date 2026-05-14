import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { getPollerState } from '../services/poller-state.js';

export const status = {
  data: new SlashCommandBuilder().setName('status').setDescription('Show Vaultr runtime status'),
  async execute(interaction: any) {
    const state = getPollerState();
    await interaction.reply({
      content:
        `Vaultr status:\n` +
        `source: **${state.sourceMode}**\n` +
        `poll_interval_seconds: **${state.pollIntervalSeconds}**\n` +
        `last_run_at: **${state.lastRunAt ?? 'not yet'}**\n` +
        `last_run_matches_sent: **${state.lastRunMatchesSent}**\n` +
        `total_matches_sent: **${state.totalMatchesSent}**\n` +
        `last_error: **${state.lastError ?? 'none'}**`,
      flags: MessageFlags.Ephemeral
    });
  }
};
