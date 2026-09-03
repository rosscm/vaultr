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
  illustrator?: string;
  promoContext: string;
  releaseType?: string;
  releaseEvent: string;
  additionalReleaseEvents?: string[];
  aliases?: string[];
  references: CuratedJapanesePromoReference[];
  verifiedSupplement?: boolean;
};

function pokumonReference(): CuratedJapanesePromoReference {
  return { sourceName: 'POKUMON', kind: 'metadata_reference' };
}

function dextcgReference(sourceId: string): CuratedJapanesePromoReference {
  return { sourceName: 'DEXTCG', sourceId, kind: 'source_identity' };
}

const mcdonaldsPokemon = [
  ['001', 'Bulbasaur'],
  ['002', 'Oddish'],
  ['003', 'Chikorita'],
  ['004', 'Charmander'],
  ['005', 'Vulpix'],
  ['006', 'Cyndaquil'],
  ['007', 'Squirtle'],
  ['008', 'Totodile'],
  ['009', 'Marill'],
  ['010', 'Pikachu'],
  ['011', 'Chinchou'],
  ['012', 'Mareep'],
  ['013', 'Abra'],
  ['014', 'Slowpoke'],
  ['015', 'Natu'],
  ['016', 'Sandshrew'],
  ['017', 'Phanpy'],
  ['018', 'Larvitar']
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
    references: [pokumonReference(), dextcgReference(`jpn_mcdemp-${Number(cardNumber)}`)],
    verifiedSupplement: cardNumber === '007'
  };
}

function unnumbered(
  curationId: string,
  name: string,
  promoContext: string,
  releaseEvent: string,
  releaseYear: number,
  options: Partial<Pick<CuratedJapanesePromoPrinting, 'additionalReleaseEvents' | 'aliases' | 'releaseType'>> = {}
): CuratedJapanesePromoPrinting {
  return {
    curationId,
    name,
    language: 'ja',
    isUnnumbered: true,
    releaseYear,
    promoContext,
    releaseType: options.releaseType ?? 'special_distribution',
    releaseEvent,
    additionalReleaseEvents: options.additionalReleaseEvents,
    aliases: options.aliases,
    references: [
      pokumonReference(),
      ...(options.additionalReleaseEvents ?? []).map((event) => ({
        sourceName: 'POKUMON' as const,
        kind: 'distribution_reference' as const,
        sourceId: event
      }))
    ]
  };
}

export const CURATED_JAPANESE_PROMOS: CuratedJapanesePromoPrinting[] = [
  ...mcdonaldsPokemon.map(mcdonaldsRecord),
  unnumbered('jp-promo-song-best-arcanine', 'Arcanine', 'Pokemon Song Best Collection CD', 'Pokemon Song Best Collection CD', 1997, { additionalReleaseEvents: ['Toyota campaign'] }),
  unnumbered('jp-promo-song-best-computer-error', 'Computer Error', 'Pokemon Song Best Collection CD', 'Pokemon Song Best Collection CD', 1997, { additionalReleaseEvents: ['CoroCoro'] }),
  unnumbered('jp-promo-song-best-cool-porygon', 'Cool Porygon', 'Pokemon Song Best Collection CD', 'Pokemon Song Best Collection CD', 1997, { additionalReleaseEvents: ['Nintendo 64 W Double Get'] }),
  unnumbered('jp-promo-song-best-hungry-snorlax', 'Hungry Snorlax', 'Pokemon Song Best Collection CD', 'Pokemon Song Best Collection CD', 1997, { additionalReleaseEvents: ['Nintendo 64 W Double Get'] }),
  unnumbered('jp-promo-song-best-mew', 'Mew', 'Pokemon Song Best Collection CD', 'Pokemon Song Best Collection CD', 1997, { additionalReleaseEvents: ['World Hobby Fair Special Sheet'] }),
  unnumbered('jp-promo-song-best-mewtwo', 'Mewtwo', 'Pokemon Song Best Collection CD', 'Pokemon Song Best Collection CD', 1997, { additionalReleaseEvents: ['World Hobby Fair Special Sheet'] }),
  unnumbered('jp-promo-song-best-super-energy-retrieval', 'Super Energy Retrieval', 'Pokemon Song Best Collection CD', 'Pokemon Song Best Collection CD', 1997, { additionalReleaseEvents: ['Pocket Monsters Fan Book'] }),
  ...['Mankey', 'Psyduck', 'Jynx', 'Sunkern', 'Hoppip', "_____'s Pikachu"].map((name) =>
    unnumbered(`jp-promo-natta-wake-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, name, 'How I Became a Pokemon Card', 'How I Became a Pokemon Card', 1999, { aliases: [`${name} Natta Wake Japanese promo`] })
  ),
  ...['Bulbasaur', 'Gyarados', 'Magikarp', 'Pikachu', 'Poliwag'].map((name) =>
    unnumbered(`jp-promo-corocoro-photo-1999-${name.toLowerCase()}`, name, 'CoroCoro Best Photo Contest', 'CoroCoro Best Photo Contest 1999', 1999)
  ),
  ...['Chikorita', 'Cyndaquil', 'Totodile'].map((name) =>
    unnumbered(`jp-promo-whf-2000-${name.toLowerCase()}`, name, 'World Hobby Fair 2000', 'World Hobby Fair 2000', 2000)
  ),
  ...['Marill', 'Togepi'].map((name) =>
    unnumbered(`jp-promo-ana-jet-2000-${name.toLowerCase()}`, name, 'ANA Get in a Jet! 2000', 'ANA Get in a Jet! 2000', 2000, { releaseType: 'airline_campaign' })
  ),
  ...['Hitmontop', 'Igglybuff'].map((name) =>
    unnumbered(`jp-promo-entei-theatrical-2000-${name.toLowerCase()}`, name, 'Spell of the Unown: Entei theatrical release', 'Spell of the Unown: Entei Japanese theatrical release', 2000, { releaseType: 'theatrical_release' })
  ),
  unnumbered('jp-promo-jr-train-rally-1997-mew', 'Mew', 'JR Train Rally 1997', 'JR Train Rally 1997', 1997, { releaseType: 'train_rally' }),
  unnumbered('jp-promo-jr-train-rally-1997-surfing-pikachu', 'Surfing Pikachu', 'JR Train Rally 1997', 'JR Train Rally 1997', 1997, { releaseType: 'train_rally' }),
  ...['Pikachu', 'Exeggutor', 'Murkrow', 'Darkness Energy', 'Steelix', 'Smeargle', 'Unown', 'Misdreavus', 'Dark Ivysaur', 'Dark Venusaur'].map((name) =>
    unnumbered(`jp-promo-trainers-magazine-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, name, 'Pokemon Card Trainers Magazine', 'Pokemon Card Trainers Magazine', 1998, { aliases: [`${name} Pokemon Card Trainers Magazine Japanese promo`] })
  )
];

export function curatedJapanesePromoCountsByFamily(records = CURATED_JAPANESE_PROMOS): Record<string, number> {
  return records.reduce<Record<string, number>>((counts, record) => {
    counts[record.promoContext] = (counts[record.promoContext] ?? 0) + 1;
    return counts;
  }, {});
}
