import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { getAlertFeedbackInsights, listRecentAlerts, type AlertFeedbackReason } from '../services/chase-store.js';
import { infoEmbed } from '../ui/embeds.js';
import { formatTimeWithAge } from '../ui/time.js';

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

export const alertsRecent = {
  data: new SlashCommandBuilder()
    .setName('alerts-recent')
    .setDescription('Show recent Vaultr sightings sent to your DMs')
    .addIntegerOption((opt) =>
      opt
        .setName('limit')
        .setDescription('How many alerts to show (max 20)')
        .setMinValue(1)
        .setMaxValue(20)
    ),
  async execute(interaction: any) {
    const limit = interaction.options.getInteger('limit') ?? 10;
    const recent = listRecentAlerts(interaction.user.id, limit);

    if (recent.length === 0) {
      await interaction.reply({
        embeds: [infoEmbed('📨 Recent Sightings', 'No sightings yet\n\n**Next:** Keep your chases active; Vaultr will DM you when something fitting surfaces')],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const lines = recent.map((a, i) => {
      const title = a.listingTitle ?? a.listingId;
      const price = a.listingPrice !== undefined ? `${a.listingPrice.toFixed(2)} ${a.listingCurrency ?? ''}`.trim() : 'None';
      const score = a.matchScore ?? 'None';
      return `**${i + 1}. ${title}**\n**Price:** ${price} | **Fit Score:** ${score}\n**Sent:** ${formatTimeWithAge(a.sentAt)}`;
    });

    await interaction.reply({
      embeds: [
        infoEmbed(
          '📨 Recent Sightings',
          [lines.join('\n\n---\n\n'), formatLearningNote(interaction.user.id)].filter(Boolean).join('\n\n')
        )
      ],
      flags: MessageFlags.Ephemeral
    });
  }
};
