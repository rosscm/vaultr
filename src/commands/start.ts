import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import {
  countUserChases,
  getUserAlertSettings,
  getUserPlan
} from '../services/chase-store.js';
import { activePlanLimits, activePlanTier } from '../services/plans.js';
import { infoEmbed } from '../ui/embeds.js';

export const start = {
  data: new SlashCommandBuilder()
    .setName('start')
    .setDescription('Open your Vault and begin your first chase'),
  async execute(interaction: any) {
    const plan = getUserPlan(interaction.user.id);
    const settings = getUserAlertSettings(interaction.user.id);
    const activeChases = countUserChases(interaction.user.id);
    const activeTier = activePlanTier(plan);
    const limits = activePlanLimits(plan);

    const lines = [
      '**Build your Vault. Chase your grails. Discover what you love next.**',
      '',
      '**Step 1:** Add a card you are chasing with `/chase add`',
      '**Step 2:** Tune your sighting controls with `/alerts settings`',
      '**Step 3:** Use `/discover` when you want Vaultr to find a new lane',
      '**Step 4:** Watch your DMs for chase sightings and weekly recaps',
      '',
      `**Plan:** ${activeTier}${plan.tier !== activeTier ? ` (${plan.tier} ${plan.status}; Pro paused)` : ''}`,
      `**Active Chases:** ${activeChases}/${limits.maxActiveChases}`,
      `**Minimum Confidence:** ${settings.minScore}`,
      `**Price Currency:** ${settings.alertCurrency}`,
      '',
      '**Tip:** Add the card number when it matters; use `/discover focus:<idea>` to steer future finds'
    ];

    await interaction.reply({
      embeds: [infoEmbed('🗝️ Start Your Vault', lines.join('\n'))],
      flags: MessageFlags.Ephemeral
    });
  }
};
