import { db } from './db.js';
import type { DiscoverySuggestion } from './discovery-catalog.js';

export type DiscoveryUserUniverseCard = {
  userId: string;
  cardKey: string;
  canonicalName: string;
  score: number;
  scoreComponents: Record<string, number>;
  suggestion: DiscoverySuggestion;
  imageUrl?: string;
  imageSourceName?: string;
  sourceCardId?: string;
  marketTotal?: number;
  marketCurrency?: string;
  createdAt: string;
  updatedAt: string;
};

type DiscoveryUserUniverseCardRow = {
  user_id: string;
  card_key: string;
  canonical_name: string;
  score: number;
  score_components_json: string;
  suggestion_json: string;
  image_url: string | null;
  image_source_name: string | null;
  source_card_id: string | null;
  market_total: number | null;
  market_currency: string | null;
  created_at: string;
  updated_at: string;
};

type UpsertDiscoveryUserUniverseCardInput = {
  userId: string;
  cardKey: string;
  canonicalName: string;
  score: number;
  scoreComponents: Record<string, number>;
  suggestion: DiscoverySuggestion;
  imageUrl?: string;
  imageSourceName?: string;
  sourceCardId?: string;
  marketTotal?: number;
  marketCurrency?: string;
};

const deleteDiscoveryUserUniverseStmt = db.prepare(`
  DELETE FROM discovery_user_universe
  WHERE user_id = ?
`);

const upsertDiscoveryUserUniverseCardStmt = db.prepare(`
  INSERT INTO discovery_user_universe (
    user_id, card_key, canonical_name, score, score_components_json, suggestion_json,
    image_url, image_source_name, source_card_id, market_total, market_currency, created_at, updated_at
  )
  VALUES (
    @user_id, @card_key, @canonical_name, @score, @score_components_json, @suggestion_json,
    @image_url, @image_source_name, @source_card_id, @market_total, @market_currency, @created_at, @updated_at
  )
  ON CONFLICT(user_id, card_key) DO UPDATE SET
    canonical_name = excluded.canonical_name,
    score = excluded.score,
    score_components_json = excluded.score_components_json,
    suggestion_json = excluded.suggestion_json,
    image_url = COALESCE(excluded.image_url, discovery_user_universe.image_url),
    image_source_name = COALESCE(excluded.image_source_name, discovery_user_universe.image_source_name),
    source_card_id = COALESCE(excluded.source_card_id, discovery_user_universe.source_card_id),
    market_total = COALESCE(excluded.market_total, discovery_user_universe.market_total),
    market_currency = COALESCE(excluded.market_currency, discovery_user_universe.market_currency),
    updated_at = excluded.updated_at
`);

const listDiscoveryUserUniverseCardsStmt = db.prepare(`
  SELECT user_id, card_key, canonical_name, score, score_components_json, suggestion_json,
         image_url, image_source_name, source_card_id, market_total, market_currency, created_at, updated_at
  FROM discovery_user_universe
  WHERE user_id = ?
  ORDER BY score DESC, updated_at DESC, canonical_name ASC
  LIMIT ?
`);

function mapRow(row: DiscoveryUserUniverseCardRow): DiscoveryUserUniverseCard {
  return {
    userId: row.user_id,
    cardKey: row.card_key,
    canonicalName: row.canonical_name,
    score: row.score,
    scoreComponents: JSON.parse(row.score_components_json) as Record<string, number>,
    suggestion: JSON.parse(row.suggestion_json) as DiscoverySuggestion,
    imageUrl: row.image_url ?? undefined,
    imageSourceName: row.image_source_name ?? undefined,
    sourceCardId: row.source_card_id ?? undefined,
    marketTotal: row.market_total ?? undefined,
    marketCurrency: row.market_currency ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function replaceDiscoveryUserUniverseCards(userId: string, cards: UpsertDiscoveryUserUniverseCardInput[]): void {
  const now = new Date().toISOString();
  const transaction = db.transaction((items: UpsertDiscoveryUserUniverseCardInput[]) => {
    deleteDiscoveryUserUniverseStmt.run(userId);
    for (const item of items) {
      upsertDiscoveryUserUniverseCardStmt.run({
        user_id: item.userId,
        card_key: item.cardKey,
        canonical_name: item.canonicalName,
        score: item.score,
        score_components_json: JSON.stringify(item.scoreComponents),
        suggestion_json: JSON.stringify(item.suggestion),
        image_url: item.imageUrl ?? null,
        image_source_name: item.imageSourceName ?? null,
        source_card_id: item.sourceCardId ?? null,
        market_total: item.marketTotal ?? null,
        market_currency: item.marketCurrency ?? null,
        created_at: now,
        updated_at: now
      });
    }
  });
  transaction(cards);
}

export function listDiscoveryUserUniverseCards(userId: string, limit = 500): DiscoveryUserUniverseCard[] {
  const rows = listDiscoveryUserUniverseCardsStmt.all(userId, Math.max(1, Math.min(5000, Math.floor(limit)))) as DiscoveryUserUniverseCardRow[];
  return rows.map(mapRow);
}
