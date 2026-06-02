import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { infoEmbed } from '../ui/embeds.js';

export const help = {
  data: new SlashCommandBuilder().setName('help').setDescription('Show the Vaultr collector guide'),
  async execute(interaction: any) {
    const lines = [
      'Build your Vault with cards you care about, then let Vaultr watch quietly for fitting moments.',
      'Your chases shape both grail alerts and future discovery.',
      '',
      '**Chase Basics**',
      '- `card`: 3-100 chars (required)',
      '- `max_price`: > 0 (optional; default: no max)',
      '- `grading_type` and `grade_value`: choose graded, raw, or any grade preference',
      '- Free Vaults can keep 3 active chases; Pro expands that to 50',
      '- Pro precision controls: condition thresholds, `listing_type`, `negative_keywords`, `priority`, `target_note`',
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
      '  defaults in `/alerts settings`: `source=eBay`, `min_score=60`, `alert_volume=BALANCED` (10/hour), `alert_currency=USD`, `shipping=OFF`',
      '  trusted shop sources are Pro: useful for raw singles, promos, and shop restocks',
      '  confidence meaning: higher confidence means a stronger fit with your chase',
      '- Plan: `/plan view` · `/upgrade`',
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
      '- `confidence`: how strongly a listing fits your chase',
      '- `signals`: the main reasons a sighting surfaced'
    ];

    await interaction.reply({
      embeds: [infoEmbed('🗝️ Vaultr Guide', lines.join('\n'))],
      flags: MessageFlags.Ephemeral
    });
  }
};
