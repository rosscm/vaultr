import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';

const COLORS = {
  info: 0x3b82f6,
  success: 0x10b981,
  warning: 0xf59e0b,
  danger: 0xef4444
} as const;

export function successEmbed(title: string, description?: string): EmbedBuilder {
  return new EmbedBuilder().setColor(COLORS.success).setTitle(title).setDescription(description ?? null).setTimestamp();
}

export function infoEmbed(title: string, description?: string): EmbedBuilder {
  return new EmbedBuilder().setColor(COLORS.info).setTitle(title).setDescription(description ?? null).setTimestamp();
}

export function warningEmbed(title: string, description?: string): EmbedBuilder {
  return new EmbedBuilder().setColor(COLORS.warning).setTitle(title).setDescription(description ?? null).setTimestamp();
}

export function errorEmbed(title: string, description?: string): EmbedBuilder {
  return new EmbedBuilder().setColor(COLORS.danger).setTitle(title).setDescription(description ?? null).setTimestamp();
}

export function keyValue(name: string, value: string): { name: string; value: string; inline: true } {
  return {
    name,
    value,
    inline: true
  };
}

export function listingLinkButton(url: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Open Listing').setURL(url)
  );
}
