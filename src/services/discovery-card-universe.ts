import { db } from './db.js';
import type { DiscoverySuggestion } from './discovery-catalog.js';

export type DiscoveryUniverseCard = {
  cardKey: string;
  canonicalName: string;
  suggestion: DiscoverySuggestion;
  lane?: string;
  sourceName?: string;
  imageUrl?: string;
  imageSourceName?: string;
  sourceCardId?: string;
  subjectTokens: string[];
  traitTokens: string[];
  marketTotal?: number;
  marketCurrency?: string;
  observationCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  updatedAt: string;
};

type DiscoveryUniverseCardRow = {
  card_key: string;
  canonical_name: string;
  suggestion_json: string;
  lane: string | null;
  source_name: string | null;
  image_url: string | null;
  image_source_name: string | null;
  source_card_id: string | null;
  subject_tokens_json: string;
  trait_tokens_json: string;
  market_total: number | null;
  market_currency: string | null;
  observation_count: number;
  first_seen_at: string;
  last_seen_at: string;
  updated_at: string;
};

type UpsertDiscoveryUniverseCardInput = {
  canonicalName: string;
  suggestion: DiscoverySuggestion;
  lane?: string;
  sourceName?: string;
  imageUrl?: string;
  imageSourceName?: string;
  sourceCardId?: string;
  subjectTokens: string[];
  traitTokens: string[];
  marketTotal?: number;
  marketCurrency?: string;
  seenAt?: string;
};

const getDiscoveryUniverseCardStmt = db.prepare(`
  SELECT card_key, canonical_name, suggestion_json, lane, source_name, image_url, image_source_name, source_card_id,
         subject_tokens_json, trait_tokens_json, market_total, market_currency, observation_count, first_seen_at, last_seen_at, updated_at
  FROM discovery_card_universe
  WHERE card_key = ?
`);

const listDiscoveryUniverseCardsStmt = db.prepare(`
  SELECT card_key, canonical_name, suggestion_json, lane, source_name, image_url, image_source_name, source_card_id,
         subject_tokens_json, trait_tokens_json, market_total, market_currency, observation_count, first_seen_at, last_seen_at, updated_at
  FROM discovery_card_universe
  ORDER BY observation_count DESC, last_seen_at DESC, canonical_name ASC
  LIMIT ?
`);

const upsertDiscoveryUniverseCardStmt = db.prepare(`
  INSERT INTO discovery_card_universe (
    card_key, canonical_name, suggestion_json, lane, source_name, image_url, image_source_name, source_card_id,
    subject_tokens_json, trait_tokens_json, market_total, market_currency, observation_count, first_seen_at, last_seen_at, updated_at
  )
  VALUES (
    @card_key, @canonical_name, @suggestion_json, @lane, @source_name, @image_url, @image_source_name, @source_card_id,
    @subject_tokens_json, @trait_tokens_json, @market_total, @market_currency, 1, @first_seen_at, @last_seen_at, @updated_at
  )
  ON CONFLICT(card_key) DO UPDATE SET
    canonical_name = excluded.canonical_name,
    suggestion_json = excluded.suggestion_json,
    lane = COALESCE(excluded.lane, discovery_card_universe.lane),
    source_name = COALESCE(excluded.source_name, discovery_card_universe.source_name),
    image_url = COALESCE(excluded.image_url, discovery_card_universe.image_url),
    image_source_name = COALESCE(excluded.image_source_name, discovery_card_universe.image_source_name),
    source_card_id = COALESCE(excluded.source_card_id, discovery_card_universe.source_card_id),
    subject_tokens_json = CASE
      WHEN excluded.subject_tokens_json = '[]' THEN discovery_card_universe.subject_tokens_json
      ELSE excluded.subject_tokens_json
    END,
    trait_tokens_json = CASE
      WHEN excluded.trait_tokens_json = '[]' THEN discovery_card_universe.trait_tokens_json
      ELSE excluded.trait_tokens_json
    END,
    market_total = COALESCE(excluded.market_total, discovery_card_universe.market_total),
    market_currency = COALESCE(excluded.market_currency, discovery_card_universe.market_currency),
    observation_count = discovery_card_universe.observation_count + 1,
    last_seen_at = excluded.last_seen_at,
    updated_at = excluded.updated_at
`);

const deleteDiscoveryUniverseCardsStmt = db.prepare(`
  DELETE FROM discovery_card_universe
`);

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function mapRow(row: DiscoveryUniverseCardRow): DiscoveryUniverseCard {
  return {
    cardKey: row.card_key,
    canonicalName: row.canonical_name,
    suggestion: JSON.parse(row.suggestion_json) as DiscoverySuggestion,
    lane: row.lane ?? undefined,
    sourceName: row.source_name ?? undefined,
    imageUrl: row.image_url ?? undefined,
    imageSourceName: row.image_source_name ?? undefined,
    sourceCardId: row.source_card_id ?? undefined,
    subjectTokens: JSON.parse(row.subject_tokens_json) as string[],
    traitTokens: JSON.parse(row.trait_tokens_json) as string[],
    marketTotal: row.market_total ?? undefined,
    marketCurrency: row.market_currency ?? undefined,
    observationCount: row.observation_count,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    updatedAt: row.updated_at
  };
}

export function discoveryUniverseCardKey(name: string): string {
  return normalize(name);
}

export function getDiscoveryUniverseCard(cardKey: string): DiscoveryUniverseCard | null {
  const row = getDiscoveryUniverseCardStmt.get(cardKey) as DiscoveryUniverseCardRow | undefined;
  return row ? mapRow(row) : null;
}

export function listDiscoveryUniverseCards(limit = 500): DiscoveryUniverseCard[] {
  const rows = listDiscoveryUniverseCardsStmt.all(Math.max(1, Math.min(5000, Math.floor(limit)))) as DiscoveryUniverseCardRow[];
  return rows.map(mapRow);
}

export function upsertDiscoveryUniverseCard(input: UpsertDiscoveryUniverseCardInput): void {
  const cardKey = discoveryUniverseCardKey(input.canonicalName);
  const now = input.seenAt ?? new Date().toISOString();
  upsertDiscoveryUniverseCardStmt.run({
    card_key: cardKey,
    canonical_name: input.canonicalName,
    suggestion_json: JSON.stringify(input.suggestion),
    lane: input.lane ?? input.suggestion.lane ?? null,
    source_name: input.sourceName ?? input.suggestion.referenceSourceName ?? null,
    image_url: input.imageUrl ?? input.suggestion.referenceImageUrl ?? null,
    image_source_name: input.imageSourceName ?? input.suggestion.referenceSourceName ?? null,
    source_card_id: input.sourceCardId ?? input.suggestion.referenceSourceCardId ?? null,
    subject_tokens_json: JSON.stringify(input.subjectTokens),
    trait_tokens_json: JSON.stringify(input.traitTokens),
    market_total: input.marketTotal ?? input.suggestion.minimumExampleTotalCad ?? null,
    market_currency: input.marketCurrency ?? null,
    first_seen_at: now,
    last_seen_at: now,
    updated_at: now
  });
}

export function deleteDiscoveryUniverseCards(): void {
  deleteDiscoveryUniverseCardsStmt.run();
}
