import type { CuratedJapanesePromoPrinting } from './curated-japanese-promos.js';

const trainersPromoContext = 'Pokemon Card Trainers Magazine T Promos';

function pokumonReference(url: string): CuratedJapanesePromoPrinting['references'][number] {
  return { sourceName: 'POKUMON', url, kind: 'source_identity' };
}

function tPromo(
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
    references: [pokumonReference(`https://pokumon.com/card/${name.toLowerCase().replace(/\?/g, '').replace(/'/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${cardNumber.slice(0, 3)}-t-japanese-promo/`)]
  };
}

export const POKUMON_JAPANESE_PROMO_SUPPLEMENT: CuratedJapanesePromoPrinting[] = [
  tPromo('001/T', 'Flareon', 'Pokémon Card Trainers Vol. 14 (January 2002)', 2002, 'Sumiyoshi Kizuki', 'https://cdn6966.templcdn.com/wp-content/uploads/2021/03/JP_001T.jpg'),
  tPromo('002/T', 'Vaporeon', 'Pokémon Card Trainers Vol. 14 (January 2002)', 2002, 'Sumiyoshi Kizuki', 'https://cdn6966.templcdn.com/wp-content/uploads/2021/03/JP_002T.jpg'),
  tPromo('003/T', 'Jolteon', 'Pokémon Card Trainers Vol. 14 (January 2002)', 2002, 'Sumiyoshi Kizuki', 'https://cdn6966.templcdn.com/wp-content/uploads/2021/03/JP_003T.jpg'),
  tPromo('004/T', 'Slowpoke', 'Pokémon Card Trainers Vol. 15 (March 2002)', 2002, 'Yukiko Baba', 'https://cdn6966.templcdn.com/wp-content/uploads/2021/03/JP_004T.jpg'),
  tPromo('005/T', 'Slowbro', 'Pokémon Card Trainers Vol. 15 (March 2002)', 2002, 'Yukiko Baba', 'https://cdn6966.templcdn.com/wp-content/uploads/2021/03/JP_005T.jpg'),
  tPromo('006/T', 'Slowking', 'Pokémon Card Trainers Vol. 15 (March 2002)', 2002, 'Yukiko Baba', 'https://cdn6966.templcdn.com/wp-content/uploads/2021/03/JP_006T.jpg'),
  tPromo('007/T', 'Bayleef', 'Pokémon Card Trainers Vol. 16 (May 2002)', 2002, 'Mitsuhiro Arita', 'https://cdn6966.templcdn.com/wp-content/uploads/2021/03/JP_007T.jpg'),
  tPromo('008/T', 'Quilava', 'Pokémon Card Trainers Vol. 16 (May 2002)', 2002, 'Mitsuhiro Arita', 'https://cdn6966.templcdn.com/wp-content/uploads/2021/03/JP_008T.jpg'),
  tPromo('009/T', 'Croconaw', 'Pokémon Card Trainers Vol. 16 (May 2002)', 2002, 'Mitsuhiro Arita', 'https://cdn6966.templcdn.com/wp-content/uploads/2021/03/JP_009T.jpg'),
  tPromo('010/T', 'Ivysaur', 'Pokémon Card Trainers Vol. 17 (July 2002)', 2002, 'Kyoko Umemoto', 'https://cdn6966.templcdn.com/wp-content/uploads/2021/03/JP_010T.jpg'),
  tPromo('011/T', 'Charmeleon', 'Pokémon Card Trainers Vol. 17 (July 2002)', 2002, 'Kyoko Umemoto', 'https://cdn6966.templcdn.com/wp-content/uploads/2021/03/JP_011T.jpg'),
  tPromo('012/T', 'Wartortle', 'Pokémon Card Trainers Vol. 17 (July 2002)', 2002, 'Kyoko Umemoto', 'https://cdn6966.templcdn.com/wp-content/uploads/2021/03/JP_012T.jpg'),
  tPromo('013/T', 'Moltres', 'Pokémon Card Trainers Vol. 18 (September 2002)', 2002, 'Midori Harada', 'https://cdn6966.templcdn.com/wp-content/uploads/2021/03/JP_013T.jpg'),
  tPromo('014/T', 'Articuno', 'Pokémon Card Trainers Vol. 18 (September 2002)', 2002, 'Midori Harada', 'https://cdn6966.templcdn.com/wp-content/uploads/2021/03/JP_014T.jpg'),
  tPromo('015/T', 'Zapdos', 'Pokémon Card Trainers Vol. 18 (September 2002)', 2002, 'Midori Harada', 'https://cdn6966.templcdn.com/wp-content/uploads/2021/03/JP_015T.jpg'),
  tPromo('016/T', 'Dratini', 'Pokémon Card Trainers Vol. 19 (November 2002)', 2002, 'Kouki Saitou', 'https://cdn6966.templcdn.com/wp-content/uploads/2021/03/JP_016T.jpg'),
  tPromo('017/T', 'Dragonair', 'Pokémon Card Trainers Vol. 19 (November 2002)', 2002, 'Kouki Saitou', 'https://cdn6966.templcdn.com/wp-content/uploads/2021/03/JP_017T.jpg'),
  tPromo('018/T', 'Dragonite', 'Pokémon Card Trainers Vol. 19 (November 2002)', 2002, 'Kouki Saitou', 'https://cdn6966.templcdn.com/wp-content/uploads/2021/03/JP_018T.jpg'),
  tPromo('019/T', 'Larvitar', 'Pokémon Card Trainers Vol. 20 (January 2003)', 2003, 'Hisao Nakamura', 'https://cdn6966.templcdn.com/wp-content/uploads/2021/03/JP_019T.jpg'),
  tPromo('020/T', 'Pupitar', 'Pokémon Card Trainers Vol. 20 (January 2003)', 2003, 'Hisao Nakamura', 'https://cdn6966.templcdn.com/wp-content/uploads/2021/03/JP_020T.jpg'),
  tPromo('021/T', 'Tyranitar ex', 'Pokémon Card Trainers Vol. 20 (January 2003)', 2003, 'Hisao Nakamura', 'https://cdn6966.templcdn.com/wp-content/uploads/2021/03/JP_021T.jpg'),
  tPromo('022/T', "Imakuni?'s Whismur", 'Pokémon Card Trainers Vol. 21 (March 2003)', 2003, 'Imakuni?', 'https://cdn6966.templcdn.com/wp-content/uploads/2021/03/JP_022T.jpg'),
  tPromo('023/T', "Imakuni?'s Loudred", 'Pokémon Card Trainers Vol. 21 (March 2003)', 2003, 'Imakuni?', 'https://cdn6966.templcdn.com/wp-content/uploads/2021/03/JP_023T.jpg'),
  tPromo('024/T', "Imakuni?'s Exploud ex", 'Pokémon Card Trainers Vol. 21 (March 2003)', 2003, 'Imakuni?', 'https://cdn6966.templcdn.com/wp-content/uploads/2021/03/JP_024T.jpg'),
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
