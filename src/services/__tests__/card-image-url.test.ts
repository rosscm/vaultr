import { describe, expect, it } from 'vitest';
import {
  isStructurallyValidTcgDexImageUrl,
  isStructurallyValidTrustedCardImageUrl,
  tcgDexCanonicalImageUrl
} from '../card-image-url.js';

describe('trusted card image URLs', () => {
  it('builds the canonical SVP 157 TCGdex asset path from provider identity', () => {
    expect(tcgDexCanonicalImageUrl({
      locale: 'en',
      sourceCardId: 'SVP-157',
      setId: 'SVP',
      localId: '157',
      image: 'https://assets.tcgdex.net/en/Scarlet & Violet/SVP Black Star Promos/157'
    })).toBe('https://assets.tcgdex.net/en/SV/SVP/157/high.png');
  });

  it('keeps distinct SV-P promos on distinct card-specific paths', () => {
    expect(tcgDexCanonicalImageUrl({ locale: 'ja', sourceCardId: 'SV-P-074', localId: '074', image: 'https://assets.tcgdex.net/ja/SV/SV/P' }))
      .toBe('https://assets.tcgdex.net/ja/SV/SV-P/074/high.png');
    expect(tcgDexCanonicalImageUrl({ locale: 'ja', sourceCardId: 'SV-P-001', localId: '001', image: 'https://assets.tcgdex.net/ja/SV/SV/P' }))
      .toBe('https://assets.tcgdex.net/ja/SV/SV-P/001/high.png');
  });

  it('rejects malformed or card-number-less trusted TCGdex paths', () => {
    expect(isStructurallyValidTcgDexImageUrl('https://assets.tcgdex.net/ja/SV/SV/P/high.png', '074')).toBe(false);
    expect(isStructurallyValidTrustedCardImageUrl('https://assets.tcgdex.net/ja/SV/SV/P/high.png', 'TCGdex Japanese', '074')).toBe(false);
    expect(isStructurallyValidTrustedCardImageUrl('https://assets.tcgdex.net/en/Scarlet & Violet/SVP Black Star Promos/157/high.png', 'TCGdex'))
      .toBe(false);
    expect(isStructurallyValidTrustedCardImageUrl('https://assets.tcgdex.net/en/SV/SVP/157/high.png', 'TCGdex')).toBe(true);
  });
});
