import type { Chase, Listing, MatchResult } from '../types.js';

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s/.-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toTokens(text: string): string[] {
  return normalize(text)
    .split(' ')
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

function tokenOverlapRatio(needle: string[], haystack: string[]): number {
  if (needle.length === 0) return 0;
  const haystackSet = new Set(haystack);
  let hits = 0;
  for (const token of needle) {
    if (haystackSet.has(token)) hits += 1;
  }
  return hits / needle.length;
}

function extractCardNumbers(text: string): string[] {
  const raw = text.toLowerCase();
  const normalized = normalize(text);
  const out = new Set<string>();

  // Patterns like 215/203, 55/102
  const slashMatches = normalized.match(/\b\d{1,4}\s*\/\s*\d{1,4}\b/g) ?? [];
  for (const m of slashMatches) {
    out.add(m.replace(/\s+/g, ''));
  }

  // Patterns like #55, no.55, no 55
  const hashMatches = raw.match(/(?:#|no\.?\s*)\d{1,4}\b/g) ?? [];
  for (const m of hashMatches) {
    const digits = m.match(/\d{1,4}/)?.[0];
    if (digits) out.add(`#${digits}`);
  }

  return [...out];
}

function conditionMatches(chaseCondition: string | undefined, listingCondition: string | undefined): boolean {
  if (!chaseCondition) return true;
  if (!listingCondition) return true;

  const chaseConditions = chaseCondition
    .split(',')
    .map((v) => normalize(v))
    .filter(Boolean);
  const l = normalize(listingCondition);

  const map: Record<string, string[]> = {
    nm: ['near mint', 'nm'],
    lp: ['lightly played', 'lp'],
    mp: ['moderately played', 'mp'],
    hp: ['heavily played', 'hp'],
    dmg: ['damaged', 'dmg']
  };

  return chaseConditions.some((c) => {
    const keys = map[c] ?? [c];
    return keys.some((k) => l.includes(k));
  });
}

function isUngradedPreference(grade: string | undefined): boolean {
  const g = normalize(grade ?? '');
  return g === 'ungraded' || g === 'raw';
}

function listingLooksUngraded(title: string, condition: string | undefined): boolean {
  const normalizedTitle = normalize(title);
  const normalizedCondition = normalize(condition ?? '');
  const gradedTerms = /\b(psa|bgs|cgc|sgc|beckett|graded|slabbed|slab|gem mint|mint 10)\b/;
  if (gradedTerms.test(normalizedTitle)) return false;
  return /\b(ungraded|raw)\b/.test(normalizedTitle) || /\b(ungraded|raw)\b/.test(normalizedCondition);
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, score));
}

function comparablePrice(listing: Listing): number {
  return listing.shippingCost === undefined ? listing.price : listing.price + listing.shippingCost;
}

export function matchChaseToListing(chase: Chase, listing: Listing): MatchResult {
  const reasons: string[] = [];
  let score = 0;

  const title = normalize(listing.title);
  const card = normalize(chase.cardName);
  const cardTokens = toTokens(chase.cardName);
  const titleTokens = toTokens(listing.title);
  const chaseCardNumbers = extractCardNumbers(chase.cardName);
  const listingCardNumbers = extractCardNumbers(listing.title);

  const blocked = (chase.negativeKeywords ?? [])
    .map((k) => normalize(k))
    .filter(Boolean)
    .find((k) => title.includes(k));
  if (blocked) {
    return { isMatch: false, score: 0, reasons: ['negative_keyword_block'] };
  }

  if (title.includes(card)) {
    score += 50;
    reasons.push('card_name_match_exact');
  } else {
    const overlap = tokenOverlapRatio(cardTokens, titleTokens);
    if (overlap < 0.7) {
      return { isMatch: false, score: 0, reasons: ['card_name_miss'] };
    }
    score += overlap >= 0.9 ? 45 : 35;
    reasons.push('card_name_match_tokens');
    reasons.push(`token_overlap:${Math.round(overlap * 100)}`);
  }

  if (chaseCardNumbers.length > 0) {
    const listingNumberSet = new Set(listingCardNumbers);
    const hasMatch = chaseCardNumbers.some((n) => listingNumberSet.has(n));
    if (hasMatch) {
      score += 12;
      reasons.push('card_number_match');
    } else if (listingCardNumbers.length > 0) {
      return { isMatch: false, score: 0, reasons: ['card_number_miss'] };
    }
  }

  if (isUngradedPreference(chase.grade)) {
    if (listingLooksUngraded(listing.title, listing.condition)) {
      score += 15;
      reasons.push('ungraded_match');
    } else {
      return { isMatch: false, score: 0, reasons: ['ungraded_miss'] };
    }
  } else if (chase.grade) {
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

  if (chase.listingType && chase.listingType !== 'ANY') {
    if (listing.listingType === chase.listingType) {
      score += 10;
      reasons.push('listing_type_match');
    } else {
      return { isMatch: false, score: 0, reasons: ['listing_type_miss'] };
    }
  }

  if (chase.maxPrice !== undefined) {
    if (comparablePrice(listing) <= chase.maxPrice) {
      score += 15;
      reasons.push('price_within_max');
    } else {
      return { isMatch: false, score: 0, reasons: ['price_over_max'] };
    }
  }

  if (cardTokens.length >= 3) {
    const overlap = tokenOverlapRatio(cardTokens, titleTokens);
    if (overlap < 0.85) {
      score -= 8;
      reasons.push('low_token_overlap_penalty');
    }
  }

  const sellerFeedbackPercent = listing.sellerFeedbackPercent;
  const sellerFeedbackScore = listing.sellerFeedbackScore;
  if (sellerFeedbackScore !== undefined && sellerFeedbackScore <= 0) {
    score -= 15;
    reasons.push('new_seller_penalty');
  } else if (sellerFeedbackScore !== undefined && sellerFeedbackScore < 10) {
    score -= 10;
    reasons.push('low_seller_feedback_count_penalty');
  } else if (sellerFeedbackPercent !== undefined && sellerFeedbackPercent < 95) {
    score -= 8;
    reasons.push('low_seller_feedback_percent_penalty');
  }

  // Seller quality boost for established trusted accounts.
  if (
    sellerFeedbackPercent !== undefined &&
    sellerFeedbackPercent >= 99 &&
    sellerFeedbackScore !== undefined &&
    sellerFeedbackScore >= 50
  ) {
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
