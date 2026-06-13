import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, StringSelectMenuBuilder } from 'discord.js';
import {
  addIgnoredListingFingerprint,
  getChase,
  getSentAlertByFeedbackToken,
  getUserPlan,
  listRecentChaseTuneOutAlerts,
  recordAlertFeedback,
  updateChase
} from '../services/chase-store.js';
import { makeListingFingerprint } from '../services/listing-fingerprint.js';
import { activePlanTier, PLAN_LIMITS } from '../services/plans.js';

const FEEDBACK_PREFIX = 'alert-feedback';
const REASON_PREFIX = 'alert-feedback-reason';
const TUNING_PREFIX = 'alert-tuning-apply';
const TUNING_MIN_PATTERN_COUNT = 2;

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

export type AlertTuningSuggestion = {
  label: string;
  terms: string[];
  count: number;
};

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\w\s/.-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const tuningTermGroups: Array<{ label: string; terms: string[]; pattern: RegExp }> = [
  { label: 'Korean variants', terms: ['korean'], pattern: /\bkorean\b/ },
  { label: 'Chinese variants', terms: ['chinese'], pattern: /\b(?:t[-\s]?chinese|traditional chinese|simplified chinese|chinese)\b/ },
  { label: 'Japanese variants', terms: ['japanese'], pattern: /\b(?:japanese|japan)\b/ },
  { label: 'Thai variants', terms: ['thai'], pattern: /\b(?:thai|thailand)\b/ },
  { label: 'Indonesian variants', terms: ['indonesian'], pattern: /\b(?:indonesian|indonesia)\b/ },
  { label: 'graded listings', terms: ['graded', 'psa', 'bgs', 'cgc'], pattern: /\b(?:graded|slabbed|slab|psa|bgs|cgc|sgc|tag|ace|beckett)\b/ },
  { label: 'lots and bundles', terms: ['lot', 'bundle'], pattern: /\b(?:lot|bundle|bulk|collection)\b/ },
  { label: 'played or damaged copies', terms: ['played', 'damaged'], pattern: /\b(?:played|damaged|dmg|creased|crease|hp|mp)\b/ },
  { label: 'accessories and merch', terms: ['sticker', 'sleeve', 'poster', 'coin'], pattern: /\b(?:sticker|sleeve|poster|coin|deck box|playmat|plush|figure|figurine)\b/ }
];

function tuningGroupLabelsForTitle(title: string): string[] {
  const normalized = normalizeText(title);
  return tuningTermGroups.filter((group) => group.pattern.test(normalized)).map((group) => group.label);
}

export function inferAlertTuningSuggestion(
  tuneOuts: Array<{ listingTitle: string }>,
  existingNegativeKeywords: string[] = []
): AlertTuningSuggestion | null {
  const existing = new Set(existingNegativeKeywords.map(normalizeText));
  const counts = new Map<string, number>();
  for (const tuneOut of tuneOuts) {
    for (const label of new Set(tuningGroupLabelsForTitle(tuneOut.listingTitle))) {
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }

  const candidates = [...counts.entries()]
    .filter(([, count]) => count >= TUNING_MIN_PATTERN_COUNT)
    .map(([label, count]) => {
      const group = tuningTermGroups.find((candidate) => candidate.label === label);
      const terms = group?.terms.filter((term) => !existing.has(normalizeText(term))) ?? [];
      return { label, terms, count };
    })
    .filter((suggestion) => suggestion.terms.length > 0)
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));

  return candidates[0] ?? null;
}

function tuningApplyRow(chaseId: string, feedbackToken: string, suggestion: AlertTuningSuggestion): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${TUNING_PREFIX}:${chaseId}:${feedbackToken}`)
      .setLabel(`Exclude ${suggestion.label}`)
      .setStyle(ButtonStyle.Primary)
  );
}

function formatTuningSuggestion(suggestion: AlertTuningSuggestion): string {
  return `Vaultr noticed ${suggestion.count} recent tune-outs for ${suggestion.label} on this chase.`;
}

function suggestionForChase(userId: string, chaseId: string): AlertTuningSuggestion | null {
  const chase = getChase(userId, chaseId);
  if (!chase) return null;
  return inferAlertTuningSuggestion(listRecentChaseTuneOutAlerts(userId, chaseId), chase.negativeKeywords ?? []);
}

async function handleApplyTuning(interaction: any): Promise<boolean> {
  if (!interaction.isButton()) return false;
  if (!interaction.customId.startsWith(`${TUNING_PREFIX}:`)) return false;

  const [, chaseId, feedbackToken] = interaction.customId.split(':');
  const alert = chaseId && feedbackToken ? getSentAlertByFeedbackToken(interaction.user.id, chaseId, feedbackToken) : null;
  const chase = chaseId ? getChase(interaction.user.id, chaseId) : null;
  if (!chaseId || !feedbackToken || !alert || !chase) {
    await interaction.update({ content: 'Could not apply that tuning rule.', components: [] });
    return true;
  }

  if (activePlanTier(getUserPlan(interaction.user.id)) !== 'PRO') {
    await interaction.update({
      content: `Vaultr can spot this pattern, but persistent chase tuning is Pro. Use \`/upgrade\` to unlock ${PLAN_LIMITS.PRO.maxActiveChases} active chases and feedback-powered tuning.`,
      components: []
    });
    return true;
  }

  const suggestion = suggestionForChase(interaction.user.id, chaseId);
  if (!suggestion) {
    await interaction.update({ content: 'That tuning pattern is already applied or no longer has enough recent signal.', components: [] });
    return true;
  }

  const existing = chase.negativeKeywords ?? [];
  const nextKeywords = [...existing, ...suggestion.terms].filter((term, index, terms) => terms.findIndex((candidate) => normalizeText(candidate) === normalizeText(term)) === index);
  updateChase(interaction.user.id, chaseId, { negativeKeywords: nextKeywords });

  await interaction.update({
    content: `Applied. Vaultr will now exclude ${suggestion.label} for **${chase.cardName}**.`,
    components: []
  });
  return true;
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
  let components: ActionRowBuilder<ButtonBuilder>[] = [];
  if (reason === 'ALREADY_SEEN_BOUGHT') {
    const fingerprint = alert?.listingTitle ? makeListingFingerprint(alert.listingTitle) : '';
    if (fingerprint) {
      addIgnoredListingFingerprint(interaction.user.id, chaseId, fingerprint);
      followUp = 'Noted. Vaultr will suppress similar title repeats for this chase.';
    }
  }

  const suggestion = suggestionForChase(interaction.user.id, chaseId);
  if (suggestion) {
    const intro = formatTuningSuggestion(suggestion);
    if (activePlanTier(getUserPlan(interaction.user.id)) === 'PRO') {
      followUp = `${intro} Apply a chase rule to exclude these going forward?`;
      components = [tuningApplyRow(chaseId, feedbackToken, suggestion)];
    } else {
      followUp = `${intro} Pro can turn that into an automatic chase rule.`;
    }
  }

  await interaction.update({ content: followUp, components });
  return true;
}

export async function handleAlertFeedback(interaction: any): Promise<boolean> {
  if (await handleApplyTuning(interaction)) return true;
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
