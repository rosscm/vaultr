import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import {
  getUserAlertSettings,
  getUserPlan,
  listChases
} from '../services/chase-store.js';
import { activePlanChases, activePlanLimits, formatActivePlanAccess, pausedPlanChases } from '../services/plans.js';
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
    const limits = activePlanLimits(plan);

    const lines = [
      '**Build a sharper Vault around the cards you love.**',
      'Add your grails, promos, and favorite finds; Vaultr keeps watch for listings that fit.',
      '',
      '**Step 1:** Add a card you are chasing with `/chase add`',
      '**Step 2:** View or update your Vaultr controls with `/alerts settings`',
      '**Step 3:** Open Weekly Discovery drops from the server channel when they land',
      '**Step 4:** Watch your DMs for chase alerts and weekly recaps',
      '',
      `**Plan:** ${formatActivePlanAccess(plan)}`,
      `**Active Chases:** ${activeChases.length}/${limits.maxActiveChases}`,
      ...(pausedChases.length > 0 ? [`**Paused Chases:** ${pausedChases.length} saved for Pro`] : []),
      `**Minimum Confidence:** ${settings.minScore}`,
      `**Price Currency:** ${settings.alertCurrency}`,
      '',
      '**Tip:** Add the card number when it matters; tiny details make cleaner alerts'
    ];

    await interaction.reply({
      embeds: [infoEmbed('🏁 Getting Started', lines.join('\n'))],
      flags: MessageFlags.Ephemeral
    });
  }
};
