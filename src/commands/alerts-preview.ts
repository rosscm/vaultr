import { EmbedBuilder, MessageFlags } from 'discord.js';
import { getUserAlertSettings } from '../services/chase-store.js';
import { USE_COMPACT_ALERT_LAYOUT } from '../services/alert-policy.js';

export const previewAlert = {
  async execute(interaction: any) {
    const settings = getUserAlertSettings(interaction.user.id);
    const currency = settings.alertCurrency;
    const title = `Priority Alert · eBay`;
    const description =
      `**Umbreon VMAX Alt Art PSA 10**\n` +
      `Good alert • under max by 45.00 ${currency} • posted 2m ago`;

    const embed = new EmbedBuilder()
      .setColor(0xf59e0b)
      .setTitle(title)
      .setDescription(description);

    if (USE_COMPACT_ALERT_LAYOUT) {
      embed.addFields({
        name: '📌 Summary',
        value: [
          '**Chase:** Umbreon VMAX',
          `**Price:** 1140.00 ${currency}`,
          `**Total:** 1155.00 ${currency}`,
          '**Posted:** 2m ago',
          '**Source:** eBay',
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
          value: ['**Chase:** Umbreon VMAX', '**Priority:** HIGH', '**Note:** none'].join('\n'),
          inline: false
        },
        {
            name: '💰 Pricing Breakdown',
          value: [
            `**Price:** 1140.00 ${currency}`,
            `**Shipping:** 15.00 ${currency}`,
            `**Total:** 1155.00 ${currency}`,
            `**Total vs Max:** 45.00 ${currency} under max`,
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
      .setFooter({ text: 'Vaultr • Priority Alert' })
      .setTimestamp();

    await interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral
    });
  }
};
