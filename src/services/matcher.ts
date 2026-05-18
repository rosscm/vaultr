import type { Chase, Listing, MatchResult } from '../types.js';

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function conditionMatches(chaseCondition: string | undefined, listingCondition: string | undefined): boolean {
  if (!chaseCondition) return true;
  if (!listingCondition) return true;

  const c = normalize(chaseCondition);
  const l = normalize(listingCondition);

  const map: Record<string, string[]> = {
    nm: ['near mint', 'nm'],
    lp: ['lightly played', 'lp'],
    mp: ['moderately played', 'mp'],
    hp: ['heavily played', 'hp'],
    dmg: ['damaged', 'dmg']
  };

  const keys = map[c] ?? [c];
  return keys.some((k) => l.includes(k));
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, score));
}

export function matchChaseToListing(chase: Chase, listing: Listing): MatchResult {
  const reasons: string[] = [];
  let score = 0;

  const title = normalize(listing.title);
  const card = normalize(chase.cardName);

  const blocked = (chase.negativeKeywords ?? [])
    .map((k) => normalize(k))
    .filter(Boolean)
    .find((k) => title.includes(k));
  if (blocked) {
    return { isMatch: false, score: 0, reasons: ['negative_keyword_block'] };
  }

  if (!title.includes(card)) {
    return { isMatch: false, score: 0, reasons: ['card_name_miss'] };
  }

  score += 50;
  reasons.push('card_name_match');

  if (chase.grade) {
    const grade = normalize(chase.grade);
    if (title.includes(grade)) {
      score += 15;
      reasons.push('grade_match');
    } else {
      return { isMatch: false, score: 0, reasons: ['grade_miss'] };
    }
  }

  if (chase.condition) {
    if (conditionMatches(chase.condition, listing.condition)) {
      score += 10;
      reasons.push('condition_match');
    } else {
      return { isMatch: false, score: 0, reasons: ['condition_miss'] };
    }
  }

  if (chase.region && chase.region !== 'ANY') {
    if (chase.region === listing.region) {
      score += 10;
      reasons.push('region_match');
    } else {
      return { isMatch: false, score: 0, reasons: ['region_miss'] };
    }
  }

  if (chase.listingType && chase.listingType !== 'ANY') {
    if (listing.listingType === chase.listingType) {
      score += 10;
      reasons.push('listing_type_match');
    } else {
      return { isMatch: false, score: 0, reasons: ['listing_type_miss'] };
    }
  }

  if (chase.maxPrice !== undefined) {
    if (listing.price <= chase.maxPrice) {
      score += 15;
      reasons.push('price_within_max');
    } else {
      return { isMatch: false, score: 0, reasons: ['price_over_max'] };
    }
  }

  // Seller quality boost for trusted accounts.
  if ((listing.sellerFeedbackPercent ?? 0) >= 99) {
    score += 5;
    reasons.push('seller_quality_boost');
  }

  // Suspicious keywords reduce confidence but do not hard-fail.
  const suspiciousTerms = ['proxy', 'custom', 'reprint', 'fan art', 'fanart', 'replica', 'orica', 'lot'];
  const suspiciousHits = suspiciousTerms.filter((term) => title.includes(term));
  if (suspiciousHits.length > 0) {
    score -= 10;
    reasons.push('suspicious_title_penalty');
    reasons.push(`suspicious_terms:${suspiciousHits.slice(0, 3).join(',')}`);
  }

  return { isMatch: true, score: clampScore(score), reasons };
}
