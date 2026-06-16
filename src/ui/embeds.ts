import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { makeAlertFeedbackToken } from '../services/alert-feedback-token.js';

const COLORS = {
  info: 0x3b82f6,
  success: 0x10b981,
  warning: 0xf59e0b,
  danger: 0xef4444
} as const;

function baseEmbed(color: number, title: string, description?: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description ?? null)
    .setFooter({ text: 'Vaultr • Commands' })
    .setTimestamp();
}

export function successEmbed(title: string, description?: string): EmbedBuilder {
  return baseEmbed(COLORS.success, `✨ ${title}`, description);
}

export function infoEmbed(title: string, description?: string): EmbedBuilder {
  return baseEmbed(COLORS.info, title, description);
}

export function warningEmbed(title: string, description?: string): EmbedBuilder {
  return baseEmbed(COLORS.warning, `⚠️ ${title}`, description);
}

export function errorEmbed(title: string, description?: string): EmbedBuilder {
  return baseEmbed(COLORS.danger, `⛔ ${title}`, description);
}

export function keyValue(name: string, value: string): { name: string; value: string; inline: false } {
  return {
    name,
    value,
    inline: false
  };
}

export function listingLinkButton(url: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Open Listing').setURL(url)
  );
}

export function alertFeedbackButtons(chaseId: string, listingId: string): ActionRowBuilder<ButtonBuilder> {
  const feedbackToken = makeAlertFeedbackToken(chaseId, listingId);
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`alert-feedback:GOOD_ALERT:${chaseId}:${feedbackToken}`)
      .setLabel('Good Alert')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`alert-feedback:TUNE_OUT:${chaseId}:${feedbackToken}`)
      .setLabel('Tune Out')
      .setStyle(ButtonStyle.Secondary)
  );
}
