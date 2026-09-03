import type { CardCatalogLanguage } from '../types.js';

export type CuratedJapanesePromoReference = {
  sourceName: 'POKUMON' | 'DEXTCG' | 'TCGDEX' | 'POKEMONTCG' | 'OTHER';
  sourceId?: string;
  url?: string;
  kind: 'metadata_reference' | 'source_identity' | 'distribution_reference';
};

export type CuratedJapanesePromoPrinting = {
  curationId: string;
  name: string;
  language: CardCatalogLanguage;
  cardNumber?: string;
  printedTotal?: string;
  isUnnumbered?: boolean;
  releaseYear?: number;
  releaseDate?: string;
  illustrator?: string;
  finish?: string;
  surface?: string;
  backType?: string;
  isJumbo?: boolean;
  estimatedCopies?: number;
  estimatedCopiesQualifier?: string;
  identicalPrintingGroup?: string;
  variantOf?: string;
  promoContext: string;
  releaseType?: string;
  releaseEvent: string;
  additionalReleaseEvents?: string[];
  aliases?: string[];
  references: CuratedJapanesePromoReference[];
};

function sourceKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function dextcgReference(sourceId: string): CuratedJapanesePromoReference {
  return { sourceName: 'DEXTCG', sourceId, kind: 'source_identity' };
}

const mcdonaldsPokemon = [
  ['001', 'Bulbasaur'], ['002', 'Oddish'], ['003', 'Chikorita'], ['004', 'Charmander'], ['005', 'Vulpix'], ['006', 'Cyndaquil'],
  ['007', 'Squirtle'], ['008', 'Totodile'], ['009', 'Marill'], ['010', 'Pikachu'], ['011', 'Chinchou'], ['012', 'Mareep'],
  ['013', 'Abra'], ['014', 'Slowpoke'], ['015', 'Natu'], ['016', 'Sandshrew'], ['017', 'Phanpy'], ['018', 'Larvitar']
] as const;

function mcdonaldsRecord([cardNumber, name]: typeof mcdonaldsPokemon[number]): CuratedJapanesePromoPrinting {
  return {
    curationId: `jp-promo-mcdemp-2002-${cardNumber}`,
    name,
    language: 'ja',
    cardNumber,
    printedTotal: '018',
    releaseYear: 2002,
    promoContext: "McDonald's Pokemon-e Minimum Pack",
    releaseType: 'restaurant_campaign',
    releaseEvent: "McDonald's Pokemon-e Minimum Pack",
    aliases: [`${name} Japanese McDonald's Pokemon-e Minimum Pack ${cardNumber}/018`],
    references: [dextcgReference(`jpn_mcdemp-${Number(cardNumber)}`)]
  };
}

function unnumbered(
  curationId: string,
  name: string,
  promoContext: string,
  releaseEvent: string,
  options: Partial<Omit<CuratedJapanesePromoPrinting, 'curationId' | 'name' | 'language' | 'promoContext' | 'releaseEvent'>> = {}
): CuratedJapanesePromoPrinting {
  return {
    curationId,
    name,
    language: 'ja',
    isUnnumbered: true,
    promoContext,
    releaseType: options.releaseType ?? 'special_distribution',
    releaseEvent,
    ...options,
    references: [
      ...(options.references ?? [])
    ]
  };
}

const songBest = [
  ['Arcanine', ['Toyota campaign']],
  ['Computer Error', ['CoroCoro']],
  ['Cool Porygon', ['Nintendo 64 W Double Get']],
  ['Hungry Snorlax', ['Nintendo 64 W Double Get']],
  ['Mew', ['World Hobby Fair Special Sheet']],
  ['Mewtwo', ['World Hobby Fair Special Sheet']],
  ['Super Energy Retrieval', ['Pocket Monsters Fan Book']]
] as const;

const simpleGroups: Array<{ context: string; event: string; type?: string; year?: number; names: readonly string[] }> = [
  { context: 'World Hobby Fair 2000', event: 'World Hobby Fair 2000', type: 'event_distribution', year: 2000, names: ['Chikorita', 'Cyndaquil', 'Totodile'] },
  { context: 'Spell of the Unown: Entei theatrical release', event: 'Spell of the Unown: Entei Japanese theatrical release', type: 'theatrical_release', year: 2000, names: ['Hitmontop', 'Igglybuff'] },
  { context: 'Evolution Communication Masaki campaign', event: 'Evolution Communication Masaki campaign', type: 'mail_in_campaign', year: 1999, names: ['Alakazam', 'Gengar', 'Golem', 'Machamp', 'Omastar'] },
  { context: 'Pokemon Card Fan Club reward promos', event: 'Pokemon Card Fan Club reward program', type: 'fan_club_reward', names: ['Eevee', 'Porygon', 'Shining Magikarp'] },
  { context: 'Pokemon Snap 64 Mario Stadium photo contest', event: '64 Mario Stadium Pokemon Snap contest', type: 'photo_contest', year: 1999, names: ['Articuno', 'Chansey', 'Charmander', 'Koffing', 'Squirtle'] },
  { context: 'Early CoroCoro unnumbered promos', event: 'CoroCoro magazine distribution', type: 'magazine_promo', names: ['Pikachu', 'Jigglypuff', 'Mew', 'Mewtwo', 'Surfing Pikachu', 'Flying Pikachu', 'Imakuni?', "Brock's Vulpix", "Misty's Poliwag"] }
];

const anaPromos = [
  ['jp-promo-ana-1998-dragonite', 'Dragonite', 'ANA airline campaign 1998', 1998],
  ['jp-promo-ana-1998-flying-pikachu', 'Flying Pikachu', 'ANA airline campaign 1998', 1998],
  ['jp-promo-ana-1999-articuno', 'Articuno', 'ANA airline campaign 1999', 1999],
  ['jp-promo-ana-1999-moltres', 'Moltres', 'ANA airline campaign 1999', 1999],
  ['jp-promo-ana-1999-zapdos', 'Zapdos', 'ANA airline campaign 1999', 1999],
  ['jp-promo-ana-1999-flying-pikachu', 'Flying Pikachu', 'ANA airline campaign 1999', 1999]
] as const;

const luckyStadiumRegions = ['Hokkaido', 'Tohoku', 'Kanto', 'Chubu', 'Kansai', 'Chugoku', 'Shikoku', 'Kyushu', 'Okinawa'] as const;

const productInsertPromos = [
  ['jp-promo-official-card-file-pikachu', 'Pikachu', 'Official Card File inserts', 'Official Card File insert'],
  ['jp-promo-official-card-file-charmander', 'Charmander', 'Official Card File inserts', 'Official Card File insert'],
  ['jp-promo-pocket-monsters-fan-book-mewtwo', 'Mewtwo', 'Pocket Monsters Fan Book inserts', 'Pocket Monsters Fan Book insert'],
  ['jp-promo-toyota-campaign-arcanine', 'Arcanine', 'Toyota campaign inserts', 'Toyota campaign']
] as const;

export const CURATED_JAPANESE_PROMOS: CuratedJapanesePromoPrinting[] = [
  ...mcdonaldsPokemon.map(mcdonaldsRecord),
  ...songBest.map(([name, additionalReleaseEvents]) =>
    unnumbered(`jp-promo-song-best-${sourceKey(name)}`, name, 'Pokemon Song Best Collection CD', 'Pokemon Song Best Collection CD', {
      releaseYear: 1997,
      additionalReleaseEvents: [...additionalReleaseEvents]
    })
  ),
  ...['Mankey', 'Psyduck', 'Jynx', 'Sunkern', 'Hoppip', "_____'s Pikachu"].map((name) =>
    unnumbered(`jp-promo-natta-wake-${sourceKey(name)}`, name, 'How I Became a Pokemon Card', 'How I Became a Pokemon Card', {
      aliases: [`${name} Natta Wake Japanese promo`]
    })
  ),
  ...['Bulbasaur', 'Gyarados', 'Magikarp', 'Pikachu', 'Poliwag'].map((name) =>
    unnumbered(`jp-promo-corocoro-photo-1999-${sourceKey(name)}`, name, 'CoroCoro Best Photo Contest', 'CoroCoro Best Photo Contest 1999', {
      releaseYear: 1999,
      releaseType: 'photo_contest'
    })
  ),
  ...simpleGroups.flatMap((group) => group.names.map((name) =>
    unnumbered(`jp-promo-${sourceKey(group.context)}-${sourceKey(name)}`, name, group.context, group.event, {
      releaseYear: group.year,
      releaseType: group.type,
      variantOf: group.context.includes('Lucky Stadium') ? 'lucky-stadium-world-challenge-summer-2000' : undefined
    })
  )),
  ...productInsertPromos.map(([curationId, name, promoContext, releaseEvent]) =>
    unnumbered(curationId, name, promoContext, releaseEvent, {
      releaseType: 'product_insert',
      aliases: [`${name} ${releaseEvent} Japanese promo`]
    })
  ),
  ...['Marill', 'Togepi'].map((name) =>
    unnumbered(`jp-promo-ana-jet-2000-${sourceKey(name)}`, name, 'ANA Get in a Jet! 2000', 'ANA Get in a Jet! 2000', { releaseYear: 2000, releaseType: 'airline_campaign' })
  ),
  ...anaPromos.map(([curationId, name, event, year]) =>
    unnumbered(curationId, name, event, event, { releaseYear: year, releaseType: 'airline_campaign', variantOf: name === 'Flying Pikachu' ? 'ana-flying-pikachu' : undefined })
  ),
  unnumbered('jp-promo-tamamushi-university-magikarp', 'Magikarp', 'Tamamushi University campaign', 'Tamamushi University campaign', {
    releaseYear: 1998,
    releaseType: 'magazine_campaign'
  }),
  unnumbered('jp-promo-jr-train-rally-1997-mew', 'Mew', 'JR Train Rally 1997', 'JR Train Rally 1997', { releaseYear: 1997, releaseType: 'train_rally' }),
  unnumbered('jp-promo-jr-train-rally-1997-surfing-pikachu', 'Surfing Pikachu', 'JR Train Rally 1997', 'JR Train Rally 1997', { releaseYear: 1997, releaseType: 'train_rally' }),
  ...['Pikachu', 'Exeggutor', 'Murkrow', 'Darkness Energy', 'Steelix', 'Smeargle', 'Unown', 'Misdreavus', 'Dark Ivysaur', 'Dark Venusaur'].map((name) =>
    unnumbered(`jp-promo-trainers-magazine-${sourceKey(name)}`, name, 'Pokemon Card Trainers Magazine', 'Pokemon Card Trainers Magazine', {
      aliases: [`${name} Pokemon Card Trainers Magazine Japanese promo`]
    })
  ),
  ...['Venusaur', 'Charizard', 'Blastoise', 'Trade Please!'].map((name) =>
    unnumbered(`jp-promo-trade-please-${sourceKey(name)}`, name, 'Trade Please! campaign', 'Trade Please! campaign', {
      releaseYear: 1998,
      releaseType: 'trade_campaign'
    })
  ),
  ...luckyStadiumRegions.map((region) =>
    unnumbered(`jp-promo-lucky-stadium-2000-${sourceKey(region)}`, 'Lucky Stadium', `World Challenge Summer 2000 Lucky Stadium ${region}`, `World Challenge Summer 2000 ${region}`, {
      releaseYear: 2000,
      releaseType: 'regional_event',
      variantOf: 'lucky-stadium-world-challenge-summer-2000'
    })
  )
];

export function curatedJapanesePromoCountsByFamily(records = CURATED_JAPANESE_PROMOS): Record<string, number> {
  return records.reduce<Record<string, number>>((counts, record) => {
    counts[record.promoContext] = (counts[record.promoContext] ?? 0) + 1;
    return counts;
  }, {});
}
