import type { CuratedJapanesePromoPrinting } from './curated-japanese-promos.js';

const trainersPromoContext = 'Pokemon Card Trainers Magazine T Promos';

function pokumonReference(url: string): CuratedJapanesePromoPrinting['references'][number] {
  return { sourceName: 'POKUMON', url, kind: 'source_identity' };
}

function tPromo(
  sourceUrl: string,
  cardNumber: string,
  name: string,
  releaseEvent: string,
  releaseYear: number,
  illustrator: string,
  imageUrl: string
): CuratedJapanesePromoPrinting {
  return {
    curationId: `jp-promo-trainers-t-${cardNumber.slice(0, 3)}`,
    name,
    language: 'ja',
    cardNumber,
    verificationStatus: 'VERIFIED',
    promoContext: trainersPromoContext,
    releaseType: 'Magazine Promo',
    releaseEvent,
    releaseYear,
    illustrator,
    finish: 'Non-holo',
    imageUrl,
    aliases: [`${name} ${cardNumber} Japanese T Promo`, `${name} ${releaseEvent}`],
    references: [pokumonReference(sourceUrl)]
  };
}

export const POKUMON_JAPANESE_PROMO_SUPPLEMENT: CuratedJapanesePromoPrinting[] = [
  tPromo('https://pokumon.com/card/flareon-001-t-japanese-promo/', '001/T', 'Flareon', 'Pokémon Card Trainers Vol. 14 (January 2002)', 2002, 'Sumiyoshi Kizuki', 'https://cdn6966.templcdn.com/wp-content/uploads/2021/03/JP_001T.jpg'),
  tPromo('https://pokumon.com/card/vaporeon-002-t-japanese-promo/', '002/T', 'Vaporeon', 'Pokémon Card Trainers Vol. 14 (January 2002)', 2002, 'Sumiyoshi Kizuki', 'https://cdn6966.templcdn.com/wp-content/uploads/2021/03/JP_002T.jpg'),
  tPromo('https://pokumon.com/card/jolteon-003-t-japanese-promo/', '003/T', 'Jolteon', 'Pokémon Card Trainers Vol. 14 (January 2002)', 2002, 'Sumiyoshi Kizuki', 'https://cdn6966.templcdn.com/wp-content/uploads/2021/03/JP_003T.jpg'),
  tPromo('https://pokumon.com/card/slowpoke-004-t-japanese-promo/', '004/T', 'Slowpoke', 'Pokémon Card Trainers Vol. 15 (March 2002)', 2002, 'Yukiko Baba', 'https://cdn6966.templcdn.com/wp-content/uploads/2021/03/JP_004T.jpg'),
  tPromo('https://pokumon.com/card/slowbro-005-t-japanese-promo/', '005/T', 'Slowbro', 'Pokémon Card Trainers Vol. 15 (March 2002)', 2002, 'Yukiko Baba', 'https://cdn6966.templcdn.com/wp-content/uploads/2021/03/JP_005T.jpg'),
  tPromo('https://pokumon.com/card/slowking-006-t-japanese-promo/', '006/T', 'Slowking', 'Pokémon Card Trainers Vol. 15 (March 2002)', 2002, 'Yukiko Baba', 'https://cdn6966.templcdn.com/wp-content/uploads/2021/03/JP_006T.jpg'),
  tPromo('https://pokumon.com/card/bayleef-007-t-japanese-promo/', '007/T', 'Bayleef', 'Pokémon Card Trainers Vol. 16 (May 2002)', 2002, 'Mitsuhiro Arita', 'https://cdn6966.templcdn.com/wp-content/uploads/2021/03/JP_007T.jpg'),
  tPromo('https://pokumon.com/card/quilava-008-t-japanese-promo/', '008/T', 'Quilava', 'Pokémon Card Trainers Vol. 16 (May 2002)', 2002, 'Mitsuhiro Arita', 'https://cdn6966.templcdn.com/wp-content/uploads/2021/03/JP_008T.jpg'),
  tPromo('https://pokumon.com/card/croconaw-009-t-japanese-promo/', '009/T', 'Croconaw', 'Pokémon Card Trainers Vol. 16 (May 2002)', 2002, 'Mitsuhiro Arita', 'https://cdn6966.templcdn.com/wp-content/uploads/2021/03/JP_009T.jpg'),
  tPromo('https://pokumon.com/card/ivysaur-010-t-japanese-promo/', '010/T', 'Ivysaur', 'Pokémon Card Trainers Vol. 17 (July 2002)', 2002, 'Kyoko Umemoto', 'https://cdn6966.templcdn.com/wp-content/uploads/2021/03/JP_010T.jpg'),
  tPromo('https://pokumon.com/card/charmeleon-011-t-japanese-promo/', '011/T', 'Charmeleon', 'Pokémon Card Trainers Vol. 17 (July 2002)', 2002, 'Kyoko Umemoto', 'https://cdn6966.templcdn.com/wp-content/uploads/2021/03/JP_011T.jpg'),
  tPromo('https://pokumon.com/card/wartortle-012-t-japanese-promo/', '012/T', 'Wartortle', 'Pokémon Card Trainers Vol. 17 (July 2002)', 2002, 'Kyoko Umemoto', 'https://cdn6966.templcdn.com/wp-content/uploads/2021/03/JP_012T.jpg'),
  tPromo('https://pokumon.com/card/moltres-013-t-japanese-promo/', '013/T', 'Moltres', 'Pokémon Card Trainers Vol. 18 (September 2002)', 2002, 'Midori Harada', 'https://cdn6966.templcdn.com/wp-content/uploads/2021/03/JP_013T.jpg'),
  tPromo('https://pokumon.com/card/articuno-014-t-japanese-promo/', '014/T', 'Articuno', 'Pokémon Card Trainers Vol. 18 (September 2002)', 2002, 'Midori Harada', 'https://cdn6966.templcdn.com/wp-content/uploads/2021/03/JP_014T.jpg'),
  tPromo('https://pokumon.com/card/zapdos-015-t-japanese-promo/', '015/T', 'Zapdos', 'Pokémon Card Trainers Vol. 18 (September 2002)', 2002, 'Midori Harada', 'https://cdn6966.templcdn.com/wp-content/uploads/2021/03/JP_015T.jpg'),
  tPromo('https://pokumon.com/card/dratini-016-t-japanese-promo/', '016/T', 'Dratini', 'Pokémon Card Trainers Vol. 19 (November 2002)', 2002, 'Kouki Saitou', 'https://cdn6966.templcdn.com/wp-content/uploads/2021/03/JP_016T.jpg'),
  tPromo('https://pokumon.com/card/dragonair-017-t-japanese-promo/', '017/T', 'Dragonair', 'Pokémon Card Trainers Vol. 19 (November 2002)', 2002, 'Kouki Saitou', 'https://cdn6966.templcdn.com/wp-content/uploads/2021/03/JP_017T.jpg'),
  tPromo('https://pokumon.com/card/dragonite-018-t-japanese-promo/', '018/T', 'Dragonite', 'Pokémon Card Trainers Vol. 19 (November 2002)', 2002, 'Kouki Saitou', 'https://cdn6966.templcdn.com/wp-content/uploads/2021/03/JP_018T.jpg'),
  tPromo('https://pokumon.com/card/larvitar-019-t-japanese-promo/', '019/T', 'Larvitar', 'Pokémon Card Trainers Vol. 20 (January 2003)', 2003, 'Hisao Nakamura', 'https://cdn6966.templcdn.com/wp-content/uploads/2021/03/JP_019T.jpg'),
  tPromo('https://pokumon.com/card/pupitar-020-t-japanese-promo/', '020/T', 'Pupitar', 'Pokémon Card Trainers Vol. 20 (January 2003)', 2003, 'Hisao Nakamura', 'https://cdn6966.templcdn.com/wp-content/uploads/2021/03/JP_020T.jpg'),
  tPromo('https://pokumon.com/card/tyranitar-ex-021-t-japanese-promo/', '021/T', 'Tyranitar ex', 'Pokémon Card Trainers Vol. 20 (January 2003)', 2003, 'Hisao Nakamura', 'https://cdn6966.templcdn.com/wp-content/uploads/2021/03/JP_021T.jpg'),
  tPromo('https://pokumon.com/card/imakunis-whismur-022-t-japanese-promo/', '022/T', "Imakuni?'s Whismur", 'Pokémon Card Trainers Vol. 21 (March 2003)', 2003, 'Imakuni?', 'https://cdn6966.templcdn.com/wp-content/uploads/2021/03/JP_022T.jpg'),
  tPromo('https://pokumon.com/card/imakunis-loudred-023-t-japanese-promo/', '023/T', "Imakuni?'s Loudred", 'Pokémon Card Trainers Vol. 21 (March 2003)', 2003, 'Imakuni?', 'https://cdn6966.templcdn.com/wp-content/uploads/2021/03/JP_023T.jpg'),
  tPromo('https://pokumon.com/card/imakunis-exploud-ex-024-t-japanese-promo/', '024/T', "Imakuni?'s Exploud ex", 'Pokémon Card Trainers Vol. 21 (March 2003)', 2003, 'Imakuni?', 'https://cdn6966.templcdn.com/wp-content/uploads/2021/03/JP_024T.jpg'),
  {
    curationId: 'jp-promo-corocoro-1999-hama-chans-slowking',
    name: 'Slowking',
    language: 'ja',
    isUnnumbered: true,
    verificationStatus: 'VERIFIED',
    promoContext: 'CoroCoro magazine promo',
    releaseType: 'Magazine Promo',
    releaseEvent: 'September 1999 CoroCoro Comic (August 1999)',
    releaseYear: 1999,
    illustrator: 'Masatoshi Hamada',
    finish: 'Non-holo',
    surface: 'Glossy',
    imageUrl: 'https://cdn6966.templcdn.com/wp-content/uploads/2021/03/JP_U113Unnumbered.jpg',
    aliases: ["Hama-chan's Slowking", 'Hama chans Slowking', 'Slowking CoroCoro 1999'],
    references: [pokumonReference('https://pokumon.com/card/hama-chans-slowking-corocoro-1999-unnumbered/')]
  }
];
