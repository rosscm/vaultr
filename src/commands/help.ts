import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { infoEmbed } from '../ui/embeds.js';

export const help = {
  data: new SlashCommandBuilder().setName('help').setDescription('Show quick-start help and command guide'),
  async execute(interaction: any) {
    const lines = [
      'Start with `/chase add`, then tune noise with `/alerts settings`',
      'Alerts are sent by DM when a listing matches',
      '',
      '**Input Requirements**',
      '- `card`: 3-100 chars (required)',
      '- `max_price`: > 0 (optional; default: no max)',
      '- `grade`: up to 24 chars; use `ungraded` or `raw` for ungraded cards (optional; default: Any)',
      '- `priority`: NORMAL / HIGH / GRAIL (optional; default: NORMAL)',
      '- `listing_type`: ANY / AUCTION / BUY_IT_NOW (optional; default: ANY)',
      '- `negative_keywords`: comma-separated terms, max 15 (optional)',
      '  default: proxy, custom, reprint, lot, orica, replica',
      '',
      '**Card Name Tip**',
      '- Casing does not matter',
      '- For best matches, include card number when relevant',
      '',
      '**Commands**',
      '- Start: `/start`',
      '- Chases: `/chase add` · `/chase list` · `/chase edit` · `/chase remove` (`entries` accepts one or many values)',
      '- Alerts: `/alerts settings` · `/alerts recent` · `/alerts preview`',
      '  defaults in `/alerts settings`: `min_score=60`, `max_alerts_per_hour=10`, `chase_cooldown_minutes=30`, `alert_currency=USD`, `show_images=ON`, `compact_mode=OFF`',
      '  Pro controls: `show_images`, `compact_mode`, `quiet_start`, `quiet_end`',
      '  score meaning: higher score means stronger match confidence based on title and filter alignment',
      '- Plan: `/plan` · `/upgrade`',
      '- Setup (Admin): `/setup-channel-set` · `/community-feed` · `/plan-set`',
      '  default for `/community-feed`: `On`',
      '- Discovery: `/discover`',
      '',
      '**Troubleshooting**',
      '- If you are not seeing matches, lower `min_score` in `/alerts settings` and broaden your chase filters',
      '- If you are seeing too many matches, add more chase detail (for example card set or card number) and tighten filters like `grade`, `condition`, or `listing_type`',
      '- Duplicate listing alerts are auto-suppressed',
      '',
      '**Glossary**',
      '- `score`: match confidence based on title and filter alignment',
      '- `risk level`: caution signal from suspicious terms and seller quality',
      '- `chase cooldown`: minimum minutes between alerts for the same chase'
    ];

    await interaction.reply({
      embeds: [infoEmbed('🆘 Vaultr Help', lines.join('\n'))],
      flags: MessageFlags.Ephemeral
    });
  }
};
