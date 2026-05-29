import { ActionRowBuilder, MessageFlags, StringSelectMenuBuilder } from 'discord.js';
import { addIgnoredListingFingerprint, getSentAlertByFeedbackToken, recordAlertFeedback } from '../services/chase-store.js';
import { makeListingFingerprint } from '../services/listing-fingerprint.js';

const FEEDBACK_PREFIX = 'alert-feedback';
const REASON_PREFIX = 'alert-feedback-reason';

const tuneOutReasons = [
  { label: 'Wrong card', value: 'WRONG_CARD', description: 'The listing is not the card this chase is for' },
  { label: 'Wrong grade/type', value: 'WRONG_GRADE_TYPE', description: 'The slab, raw status, or grade is not right' },
  { label: 'Condition issue', value: 'CONDITION_ISSUE', description: 'The condition does not fit this chase' },
  { label: 'Price or shipping', value: 'PRICE_SHIPPING', description: 'The total cost or shipping details are not right' },
  { label: 'Seller concern', value: 'SELLER_CONCERN', description: 'The seller or listing quality gives pause' },
  { label: 'Already seen or bought', value: 'ALREADY_SEEN_BOUGHT', description: 'Suppress similar title repeats for this chase' },
  { label: 'Just not interested', value: 'JUST_NOT_INTERESTED', description: 'Correct alert, but not one to pursue' }
] as const;

function normalizeFeedback(value: string): 'GOOD_ALERT' | 'TUNE_OUT' | undefined {
  if (value === 'GOOD_ALERT') return 'GOOD_ALERT';
  if (value === 'TUNE_OUT') return 'TUNE_OUT';
  return undefined;
}

function tuneOutReasonMenu(chaseId: string, feedbackToken: string): ActionRowBuilder<StringSelectMenuBuilder> {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`${REASON_PREFIX}:${chaseId}:${feedbackToken}`)
      .setPlaceholder('What should Vaultr learn from this?')
      .addOptions(...tuneOutReasons)
  );
}

async function handleTuneOutReason(interaction: any): Promise<boolean> {
  if (!interaction.isStringSelectMenu()) return false;
  if (!interaction.customId.startsWith(`${REASON_PREFIX}:`)) return false;

  const [, chaseId, feedbackToken] = interaction.customId.split(':');
  const reason = interaction.values?.[0] as (typeof tuneOutReasons)[number]['value'] | undefined;
  const alert = chaseId && feedbackToken ? getSentAlertByFeedbackToken(interaction.user.id, chaseId, feedbackToken) : null;
  if (!chaseId || !feedbackToken || !alert || !tuneOutReasons.some((option) => option.value === reason)) {
    await interaction.update({ content: 'Could not record that feedback.', components: [] });
    return true;
  }

  recordAlertFeedback(interaction.user.id, chaseId, alert.listingId, 'TUNE_OUT', reason);

  let followUp = 'Noted. This helps tune future alerts.';
  if (reason === 'ALREADY_SEEN_BOUGHT') {
    const fingerprint = alert?.listingTitle ? makeListingFingerprint(alert.listingTitle) : '';
    if (fingerprint) {
      addIgnoredListingFingerprint(interaction.user.id, chaseId, fingerprint);
      followUp = 'Noted. Vaultr will suppress similar title repeats for this chase.';
    }
  }

  await interaction.update({ content: followUp, components: [] });
  return true;
}

export async function handleAlertFeedback(interaction: any): Promise<boolean> {
  if (await handleTuneOutReason(interaction)) return true;
  if (!interaction.isButton()) return false;
  if (!interaction.customId.startsWith(`${FEEDBACK_PREFIX}:`)) return false;

  const [, feedbackRaw, chaseId, feedbackToken] = interaction.customId.split(':');
  const feedback = normalizeFeedback(feedbackRaw);
  const alert = chaseId && feedbackToken ? getSentAlertByFeedbackToken(interaction.user.id, chaseId, feedbackToken) : null;
  if (!feedback || !chaseId || !feedbackToken || !alert) {
    await interaction.reply({
      content: 'Could not record that feedback.',
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  if (feedback === 'GOOD_ALERT') {
    recordAlertFeedback(interaction.user.id, chaseId, alert.listingId, feedback);
    await interaction.reply({
      content: 'Noted. This helps tune future alerts.',
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  await interaction.reply({
    content: 'What should Vaultr learn from this alert?',
    components: [tuneOutReasonMenu(chaseId, feedbackToken)],
    flags: MessageFlags.Ephemeral
  });
  return true;
}
