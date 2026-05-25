import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { infoEmbed } from '../ui/embeds.js';

export const help = {
  data: new SlashCommandBuilder().setName('help').setDescription('Show the Vaultr command guide'),
  async execute(interaction: any) {
    const lines = [
      'Build your Vault with cards you care about, then let Vaultr watch quietly for fitting moments.',
      'Your chases shape both grail alerts and future discovery.',
      '',
      '**Chase Basics**',
      '- `card`: 3-100 chars (required)',
      '- `max_price`: > 0 (optional; default: no max)',
      '- `grade`: up to 24 chars; use `ungraded` or `raw` for ungraded cards (optional; default: Any)',
      '- Pro precision controls: `condition`, `listing_type`, `negative_keywords`, `priority`, `target_note`',
      '  default blocked terms still apply automatically: proxy, custom, reprint, lot, orica, replica',
      '',
      '**Collector Tip**',
      '- Casing does not matter',
      '- For cleaner signals, include card number when relevant',
      '',
      '**Commands**',
      '- Start: `/start`',
      '- Chases: `/chase add` · `/chase list` · `/chase edit` · `/chase remove` (`entries` accepts one or many values)',
      '- Alerts: `/alerts settings` · `/alerts recent` · `/alerts preview`',
      '  defaults in `/alerts settings`: `min_score=60`, `max_alerts_per_hour=10`, `chase_cooldown_minutes=30`, `alert_currency=USD`, `show_images=ON`, `compact_mode=OFF`',
      '  Pro controls: `show_images`, `compact_mode`, `quiet_start`, `quiet_end`',
      '  score meaning: higher score means stronger fit with your chase',
      '- Plan: `/plan view` · `/plan set` · `/upgrade`',
      '- Setup (Admin): `/setup channel` · `/feed`',
      '  default for `/feed`: `On`',
      '- Discovery: `/discover`',
      '',
      '**Troubleshooting**',
      '- If your Vault feels quiet, lower `min_score` or broaden the chase',
      '- If too much is surfacing, add set/card detail or raise `min_score`',
      '- Duplicate sightings are quietly suppressed',
      '',
      '**Glossary**',
      '- `score`: how strongly a listing fits your chase',
      '- `caution`: signals from suspicious terms or seller quality',
      '- `chase cooldown`: minimum minutes between DMs for the same chase'
    ];

    await interaction.reply({
      embeds: [infoEmbed('🗝️ Vaultr Guide', lines.join('\n'))],
      flags: MessageFlags.Ephemeral
    });
  }
};
