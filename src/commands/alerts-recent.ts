import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { getAlertFeedbackInsights, listRecentAlerts, type AlertFeedbackReason } from '../services/chase-store.js';
import { infoEmbed } from '../ui/embeds.js';
import { formatTimeWithAge } from '../ui/time.js';

const MAX_FIELD_TITLE_LENGTH = 84;
const MAX_LISTING_TITLE_LENGTH = 180;

const reasonLabels: Record<AlertFeedbackReason, string> = {
  WRONG_CARD: 'wrong card',
  WRONG_GRADE_TYPE: 'wrong grade/type',
  CONDITION_ISSUE: 'condition issue',
  PRICE_SHIPPING: 'price or shipping',
  SELLER_CONCERN: 'seller concern',
  ALREADY_SEEN_BOUGHT: 'already seen or bought',
  JUST_NOT_INTERESTED: 'just not interested'
};

const reasonSuggestions: Record<AlertFeedbackReason, string> = {
  WRONG_CARD: 'tighten the chase name or add negative keywords for variants you do not want',
  WRONG_GRADE_TYPE: 'set grading type and grade value for the slab or raw status you want',
  CONDITION_ISSUE: 'set a condition threshold if surface quality is the deciding factor',
  PRICE_SHIPPING: 'review max price and shipping destination so total cost lines up with your range',
  SELLER_CONCERN: 'keep seller feedback visible and tune out sellers or listings that feel off',
  ALREADY_SEEN_BOUGHT: 'similar title repeats are being suppressed for that chase',
  JUST_NOT_INTERESTED: 'make the chase more specific or add a short target note'
};

function formatLearningNote(userId: string): string | undefined {
  const insights = getAlertFeedbackInsights(userId, 30);
  const topReason = insights.reasons[0];
  if (!topReason || topReason.count < 2) return undefined;

  const topChase = insights.topChases.find((row) => row.reason === topReason.reason && row.count >= 2);
  const scope = topChase ? ` on **${topChase.chaseName}**` : '';
  return [
    `**Vaultr noticed:** ${topReason.count} recent Tune Outs were for ${reasonLabels[topReason.reason]}${scope}.`,
    `Try to ${reasonSuggestions[topReason.reason]}.`
  ].join(' ');
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

function formatPrice(amount: number | undefined, currency: string | undefined): string {
  if (amount === undefined) return 'Unknown';
  return `${amount.toFixed(2)} ${currency ?? ''}`.trim();
}

function formatConfidence(score: number | undefined): string {
  if (score === undefined) return 'Unknown';
  if (score >= 85) return `strong (${score})`;
  if (score >= 60) return `good (${score})`;
  return `speculative (${score})`;
}

export const alertsRecent = {
  data: new SlashCommandBuilder()
    .setName('alerts-recent')
    .setDescription('Review recent sightings and what Vaultr is learning')
    .addIntegerOption((opt) =>
      opt
        .setName('limit')
        .setDescription('How many sightings to show (max 20)')
        .setMinValue(1)
        .setMaxValue(20)
    ),
  async execute(interaction: any) {
    const limit = interaction.options.getInteger('limit') ?? 10;
    const recent = listRecentAlerts(interaction.user.id, limit);

    if (recent.length === 0) {
      await interaction.reply({
        embeds: [
          infoEmbed(
            '📨 Recent Sightings',
            'No sightings yet. Keep your chases active; Vaultr will DM you when something fitting surfaces.'
          )
        ],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const embed = infoEmbed('📨 Recent Sightings', `Latest ${recent.length} chase sighting${recent.length === 1 ? '' : 's'} from your DMs.`);

    embed.addFields(
      recent.map((alert, index) => {
        const title = truncate(alert.listingTitle ?? alert.listingId, MAX_LISTING_TITLE_LENGTH);
        const listingLink = alert.listingUrl ? `\n[Open Listing](${alert.listingUrl})` : '';
        return {
          name: `${index + 1}. ${truncate(alert.chaseName ?? 'Chase sighting', MAX_FIELD_TITLE_LENGTH)}`,
          value: [
            `**Listing:** ${title}`,
            `**Price:** ${formatPrice(alert.listingPrice, alert.listingCurrency)}`,
            `**Confidence:** ${formatConfidence(alert.matchScore)}`,
            `**Sent:** ${formatTimeWithAge(alert.sentAt)}${listingLink}`
          ].join('\n'),
          inline: false
        };
      })
    );

    const learningNote = formatLearningNote(interaction.user.id);
    if (learningNote) {
      embed.addFields({
        name: '🧠 Vaultr Noticed',
        value: learningNote.replace('**Vaultr noticed:** ', ''),
        inline: false
      });
    }

    await interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral
    });
  }
};
