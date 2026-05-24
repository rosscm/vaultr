import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { getUserAlertSettings } from '../services/chase-store.js';
import { OUTPUT_STYLE } from '../ui/style.js';

export const previewAlert = {
  data: new SlashCommandBuilder()
    .setName('alerts-preview')
    .setDescription('Preview your current DM alert format'),
  async execute(interaction: any) {
    const settings = getUserAlertSettings(interaction.user.id);
    const currency = settings.alertCurrency;
    const title = `🏆 Grail Match Found · eBay`;
    const description =
      `**Umbreon VMAX Alt Art PSA 10**\n` +
      `Good match • under max by 45.00 ${currency} • posted 2m ago`;

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
          '**Match Strength:** good (72)',
          '**Risk Level:** low',
          '**Match Signals:** exact card name match, grade match',
          '**Confidence Summary:** good alignment with your chase filters'
        ].join('\n'),
        inline: false
      });
    } else {
      embed.addFields(
        {
          name: '🎯 Chase Context',
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
            '**Match Strength:** good (72)',
            '**Risk Level:** low',
            '**Match Signals:** exact card name match, grade match',
            '**Confidence Summary:** good alignment with your chase filters'
          ].join('\n'),
          inline: false
        }
      );
    }

    embed
      .setFooter({ text: 'Vaultr • Collector Alert' })
      .setTimestamp();

    await interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral
    });
  }
};
