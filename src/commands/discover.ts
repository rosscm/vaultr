import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { listChases } from '../services/chase-store.js';
import { infoEmbed } from '../ui/embeds.js';

type DiscoverySeed = {
  keywords: string[];
  theme: string;
  suggestions: string[];
};

const DISCOVERY_SEEDS: DiscoverySeed[] = [
  {
    keywords: ['umbreon', 'moonbreon', 'espeon', 'eevee'],
    theme: 'moonlit Eeveelution cards',
    suggestions: ["Karen's Umbreon", 'Umbreon VMAX 215/203', 'Espeon VMAX 270/264']
  },
  {
    keywords: ['gengar', 'darkrai', 'shadow', 'night'],
    theme: 'dark atmospheric artwork',
    suggestions: ['Gengar VMAX 271/264', 'Darkrai & Cresselia LEGEND', "Sabrina's Gengar"]
  },
  {
    keywords: ['pikachu', 'poncho', 'promo'],
    theme: 'character promo pieces',
    suggestions: ['Poncho-Wearing Pikachu', 'Mario Pikachu', 'Pretend Magikarp Pikachu']
  },
  {
    keywords: ['rayquaza', 'lugia', 'crystal', 'gold star'],
    theme: 'high-impact vintage grails',
    suggestions: ['Gold Star Rayquaza', 'Crystal Lugia', 'Rayquaza VMAX Alt Art']
  },
  {
    keywords: ['japanese', 'jp', 'vending', 'web'],
    theme: 'Japanese-only texture',
    suggestions: ['Web Series Gengar', 'Vending Series Mewtwo', 'Masaki Gengar']
  }
];

function normalize(value: string): string {
  return value.toLowerCase();
}

function pickSeed(text: string): DiscoverySeed {
  const normalized = normalize(text);
  const seed = DISCOVERY_SEEDS.find((candidate) => candidate.keywords.some((keyword) => normalized.includes(keyword)));
  return seed ?? {
    keywords: [],
    theme: 'cards with strong collector identity',
    suggestions: ['Japanese promos', 'vintage holos', 'illustration rares with matching themes']
  };
}

export const discover = {
  data: new SlashCommandBuilder()
    .setName('discover')
    .setDescription('Get collector-focused discovery suggestions')
    .addStringOption((opt) =>
      opt
        .setName('query')
        .setDescription('Optional focus, e.g. umbreon or artist:kanda')
        .setMaxLength(80)
    ),
  async execute(interaction: any) {
    const query = interaction.options.getString('query');
    const chases = listChases(interaction.user.id);
    const sourceText = query ?? chases.map((chase) => chase.cardName).join(' ');
    const seed = pickSeed(sourceText);
    const title = query ? `🔎 Discover · ${query}` : '🔎 Discover';
    const basis = query
      ? `based on \`${query}\``
      : chases.length > 0
        ? `based on your ${chases.length} active chase${chases.length === 1 ? '' : 's'}`
        : 'based on a starter collector profile';
    const lines = [
      `**Collector Thread:** ${seed.theme}`,
      `**Basis:** ${basis}`,
      '',
      '**Cards To Explore**',
      ...seed.suggestions.map((suggestion) => `- ${suggestion}`),
      '',
      '**Note:** Discovery is intentionally lightweight right now. Your active chases will shape this over time.'
    ];

    await interaction.reply({
      embeds: [infoEmbed(title, lines.join('\n'))],
      flags: MessageFlags.Ephemeral
    });
  }
};
