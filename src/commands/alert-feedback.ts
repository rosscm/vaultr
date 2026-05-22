import { MessageFlags } from 'discord.js';
import { recordAlertFeedback } from '../services/chase-store.js';

const FEEDBACK_PREFIX = 'alert-feedback';

export async function handleAlertFeedback(interaction: any): Promise<boolean> {
  if (!interaction.isButton()) return false;
  if (!interaction.customId.startsWith(`${FEEDBACK_PREFIX}:`)) return false;

  const [, feedback, chaseId, listingId] = interaction.customId.split(':');
  if ((feedback !== 'GOOD_MATCH' && feedback !== 'NOT_FOR_ME') || !chaseId || !listingId) {
    await interaction.reply({
      content: 'Could not record that feedback.',
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  recordAlertFeedback(interaction.user.id, chaseId, listingId, feedback);
  await interaction.reply({
    content: feedback === 'GOOD_MATCH' ? 'Noted. Vaultr will remember this was a good match.' : 'Noted. Vaultr will remember this was not for you.',
    flags: MessageFlags.Ephemeral
  });
  return true;
}
