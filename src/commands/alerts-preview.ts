import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { getUserAlertSettings } from '../services/chase-store.js';
import { OUTPUT_STYLE } from '../ui/style.js';

export const previewAlert = {
  data: new SlashCommandBuilder()
    .setName('alerts-preview')
    .setDescription('Preview the DM layout for a chase sighting'),
  async execute(interaction: any) {
    const settings = getUserAlertSettings(interaction.user.id);
    const currency = settings.alertCurrency;
    const title = `🏆 Grail Sighting · eBay`;
    const description =
      `**Umbreon VMAX Alt Art PSA 10**\n` +
      `Good alert • under max by 45.00 ${currency} • posted 2m ago`;

    const embed = new EmbedBuilder()
      .setColor(0xf59e0b)
      .setTitle(title)
      .setDescription(description);

    if (settings.compactMode) {
      embed.addFields({
        name: '📌 Summary',
        value: [
          '**Chase:** Umbreon VMAX',
          `**Price:** 1140.00 ${currency}`,
          `**Total:** 1155.00 ${currency}`,
          '**Posted:** 2m ago',
          '**Source:** eBay',
           '**Shipping Destination:** CA',
          '**Confidence:** good (72)',
          '**Signals:** exact card name, requested grade',
          '**Takeaway:** meets the core chase criteria'
        ].join('\n'),
        inline: false
      });
    } else {
      embed.addFields(
        {
            name: '🎯 Chase Details',
          value: ['**Chase:** Umbreon VMAX', '**Priority:** GRAIL', '**Note:** none'].join('\n'),
          inline: false
        },
        {
            name: '💰 Pricing Breakdown',
          value: [
            `**Price:** 1140.00 ${currency}`,
            `**Shipping:** 15.00 ${currency}`,
            `**Total:** 1155.00 ${currency}`,
            `**Total vs Max:** 45.00 ${currency} under max`,
             '**Shipping Destination:** CA',
            '**Listing Type:** Buy It Now'
          ].join('\n'),
          inline: false
        },
        {
          name: '📸 Listing Snapshot',
          value: [
            '**Posted:** 2m ago',
            '**Source:** eBay',
            '**Region:** US',
            '**Seller:** testuser_myukselen',
            '**Seller Feedback:** 99.8% (4231)'
          ].join('\n'),
          inline: false
        },
        {
            name: '🧠 Match Insight',
          value: [
            '**Confidence:** good (72)',
            '**Signals:** exact card name, requested grade',
            '**Takeaway:** meets the core chase criteria'
          ].join('\n'),
          inline: false
        }
      );
    }

    embed
      .setFooter({ text: 'Vaultr • Grail Sighting' })
      .setTimestamp();

    await interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral
    });
  }
};
