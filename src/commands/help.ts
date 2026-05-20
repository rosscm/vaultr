import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { infoEmbed } from '../ui/embeds.js';

export const help = {
  data: new SlashCommandBuilder().setName('help').setDescription('Show quick-start help and command guide'),
  async execute(interaction: any) {
    const lines = [
      'Start with `/chase-add`, then tune noise with `/alerts-settings`. Alerts are sent by DM when a listing matches.',
      '',
      '**Input Requirements**',
      '- `card`: 3-100 chars (required)',
      '- `max_price`: > 0 (optional, default: no max)',
      '- `grade`: up to 24 chars (optional, default: Any)',
      '- `priority`: `NORMAL` / `HIGH` / `GRAIL` (optional, default: `NORMAL`)',
      '- `listing_type`: `ANY` / `AUCTION` / `BUY_IT_NOW` (optional, default: `ANY`)',
      '- `negative_keywords`: CSV (max 15) (optional, default: `proxy,custom,reprint,lot,orica,replica`)',
      '',
      '**Card Name Tip**',
      '- Casing does not matter',
      '- For best matches, include card number and grade when relevant',
      '',
      '**Commands**',
      '- Chases: `/chase-add` · `/chase-list` · `/chase-edit` · `/chase-remove`',
      '- Alerts: `/alerts-settings` (defaults: `min_score=60`, `max_alerts_per_hour=10`, `chase_cooldown_minutes=30`, `alert_currency=USD`) · `/alerts-settings-reset` · `/alerts-recent`',
      '- Plan: `/plan` · `/upgrade`',
      '- Setup (Admin): `/setup-channel-set` · `/community-feed` (default mode: `PULSE`) · `/plan-set`',
      '- Diagnostics: `/status` · `/chase-test`'
    ];

    await interaction.reply({
      embeds: [infoEmbed('🆘 Vaultr Help', lines.join('\n'))],
      flags: MessageFlags.Ephemeral
    });
  }
};
