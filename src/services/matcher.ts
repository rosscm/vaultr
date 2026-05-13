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

export function matchChaseToListing(chase: Chase, listing: Listing): MatchResult {
  const reasons: string[] = [];
  let score = 0;

  const title = normalize(listing.title);
  const card = normalize(chase.cardName);

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

  if (chase.maxPrice !== undefined) {
    if (listing.price <= chase.maxPrice) {
      score += 15;
      reasons.push('price_within_max');
    } else {
      return { isMatch: false, score: 0, reasons: ['price_over_max'] };
    }
  }

  return { isMatch: true, score, reasons };
}
