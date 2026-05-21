import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { getUserAlertSettings } from '../services/chase-store.js';
import { infoEmbed } from '../ui/embeds.js';
import { OUTPUT_STYLE } from '../ui/style.js';

export const previewAlert = {
  data: new SlashCommandBuilder()
    .setName('preview-alert')
    .setDescription('Preview your current DM alert format'),
  async execute(interaction: any) {
    const settings = getUserAlertSettings(interaction.user.id);
    const lines = [
      '**Sample Listing:** Umbreon VMAX Alt Art PSA 10',
      '**Summary:** Good Match • under max by 60.00 CAD • posted 2m ago',
      '',
      '**Score:** 72 (Good Match)',
      '**Risk Level:** low',
      '**Match Signals:** exact card name match, grade match',
      '**Confidence Summary:** clear alignment check details before buying',
      '',
      `**Alert Currency:** ${settings.alertCurrency}`,
      `**Show Images:** ${settings.showImages ? OUTPUT_STYLE.on : OUTPUT_STYLE.off}`,
      `**Compact Mode:** ${settings.compactMode ? OUTPUT_STYLE.on : OUTPUT_STYLE.off}`,
      '',
      '**Next:** Use `/alerts-settings` to tune how your live alerts look'
    ];

    await interaction.reply({
      embeds: [infoEmbed('🧪 Alert Preview', lines.join('\n'))],
      flags: MessageFlags.Ephemeral
    });
  }
};

