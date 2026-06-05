import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import {
  getUserAlertSettings,
  getUserPlan,
  listChases
} from '../services/chase-store.js';
import { activePlanChases, activePlanLimits, activePlanTier, formatActivePlanAccess, pausedPlanChases } from '../services/plans.js';
import { infoEmbed } from '../ui/embeds.js';

export const start = {
  data: new SlashCommandBuilder()
    .setName('start')
    .setDescription('Open the Vaultr onboarding guide'),
  async execute(interaction: any) {
    const plan = getUserPlan(interaction.user.id);
    const settings = getUserAlertSettings(interaction.user.id);
    const storedChases = listChases(interaction.user.id);
    const activeChases = activePlanChases(storedChases, plan);
    const pausedChases = pausedPlanChases(storedChases, plan);
    const activeTier = activePlanTier(plan);
    const limits = activePlanLimits(plan);

    const lines = [
      '**Build your Vault. Chase your grails. Discover what you love next.**',
      'Pick the cards that matter; Vaultr will keep watch in the background.',
      '',
      '**Step 1:** Add a card you are chasing with `/chase add`',
      '**Step 2:** View or update your Vaultr controls with `/alerts settings`',
      '**Step 3:** Use `/discover` when you want Vaultr to surface a new collecting path',
      '**Step 4:** Watch your DMs for chase sightings and weekly recaps',
      '',
      `**Plan:** ${formatActivePlanAccess(plan)}`,
      `**Active Chases:** ${activeChases.length}/${limits.maxActiveChases}`,
      ...(pausedChases.length > 0 ? [`**Paused Chases:** ${pausedChases.length} saved for Pro`] : []),
      `**Minimum Confidence:** ${settings.minScore}`,
      `**Price Currency:** ${settings.alertCurrency}`,
      '',
      '**Tip:** Add the card number when it matters; tiny details make better sightings'
    ];

    await interaction.reply({
      embeds: [infoEmbed('🏁 Getting Started', lines.join('\n'))],
      flags: MessageFlags.Ephemeral
    });
  }
};
