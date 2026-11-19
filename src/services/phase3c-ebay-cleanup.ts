import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

type JsonObject = Record<string, unknown>;

export type CleanupManifestEntry = {
  location: string;
  records: number;
  distinctListingIds?: number;
  fields: Record<string, number>;
  ambiguousRetained: Record<string, number>;
};

export type Phase3cCleanupReport = {
  mode: 'DRY_RUN' | 'APPLY';
  before: CleanupManifestEntry[];
  after: CleanupManifestEntry[];
  preserved: Record<string, number>;
};

const requiredTables = [
  'alert_events',
  'sent_alerts',
  'source_observations',
  'discovery_market_cache',
  'discovery_scheduled_drop_items',
  'weekly_discovery_prepared_reserve',
  'discovery_card_universe',
  'discovery_user_universe'
];

function scalar(database: Database.Database, sql: string): number {
  const row = database.prepare(sql).get() as { value: number };
  return Number(row.value ?? 0);
}

function tableCount(database: Database.Database, table: string): number {
  return scalar(database, `SELECT COUNT(*) AS value FROM ${table}`);
}

function assertSchema(database: Database.Database): void {
  const tables = new Set((database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map((row) => row.name));
  const missing = requiredTables.filter((table) => !tables.has(table));
  if (missing.length > 0) throw new Error(`Phase 3C cleanup requires missing table(s): ${missing.join(', ')}`);
}

function alertManifest(database: Database.Database): CleanupManifestEntry {
  const row = database.prepare(`
    SELECT COUNT(*) AS records, COUNT(DISTINCT listing_id) AS distinct_ids,
      SUM(listing_title IS NOT NULL) AS titles, SUM(listing_price IS NOT NULL) AS prices,
      SUM(listing_currency IS NOT NULL) AS currencies, SUM(price_delta IS NOT NULL) AS comparisons,
      SUM(listing_url IS NOT NULL) AS urls, SUM(listing_image_url IS NOT NULL) AS images,
      SUM(listing_posted_at IS NOT NULL) AS posted, SUM(alert_latency_seconds IS NOT NULL) AS latency,
      SUM(source_first_seen_at IS NOT NULL) AS first_seen, SUM(source_last_seen_at IS NOT NULL) AS last_seen,
      SUM(listing_content_retrieved_at IS NOT NULL) AS retrieval_times,
      SUM(match_score IS NOT NULL) AS match_scores, SUM(source_rank IS NOT NULL) AS source_ranks,
      SUM(payload_json IS NOT NULL AND json_valid(payload_json) AND (
        json_extract(payload_json, '$.details.pricing') IS NOT NULL OR
        json_extract(payload_json, '$.details.listing') IS NOT NULL OR
        json_extract(payload_json, '$.listingTitle') IS NOT NULL OR
        json_extract(payload_json, '$.listingPrice') IS NOT NULL OR
        json_extract(payload_json, '$.listingUrl') IS NOT NULL OR
        json_extract(payload_json, '$.listingImageUrl') IS NOT NULL
      )) AS marketplace_payloads,
      SUM(payload_json IS NOT NULL AND json_valid(payload_json) AND json_extract(payload_json, '$.details.match') IS NOT NULL) AS match_evidence
    FROM alert_events WHERE source='EBAY'
  `).get() as Record<string, number>;
  return {
    location: 'alert_events', records: row.records, distinctListingIds: row.distinct_ids,
    fields: {
      listing_title: row.titles, listing_price: row.prices, listing_currency: row.currencies,
      price_delta: row.comparisons, listing_url: row.urls, listing_image_url: row.images,
      listing_posted_at: row.posted, alert_latency_seconds: row.latency,
      source_first_seen_at: row.first_seen, source_last_seen_at: row.last_seen,
      listing_content_retrieved_at: row.retrieval_times, marketplace_payload_json: row.marketplace_payloads
    },
    ambiguousRetained: { match_score: row.match_scores, source_rank: row.source_ranks, match_evidence: row.match_evidence }
  };
}

function sentAlertManifest(database: Database.Database): CleanupManifestEntry {
  const row = database.prepare(`
    SELECT COUNT(*) AS records, COUNT(DISTINCT listing_id) AS distinct_ids,
      SUM(listing_title IS NOT NULL) AS titles, SUM(listing_price IS NOT NULL) AS prices,
      SUM(listing_currency IS NOT NULL) AS currencies, SUM(price_delta IS NOT NULL) AS comparisons,
      SUM(listing_url IS NOT NULL) AS urls, SUM(listing_posted_at IS NOT NULL) AS posted,
      SUM(alert_latency_seconds IS NOT NULL) AS latency, SUM(source_first_seen_at IS NOT NULL) AS first_seen,
      SUM(source_last_seen_at IS NOT NULL) AS last_seen, SUM(match_score IS NOT NULL) AS match_scores,
      SUM(source_rank IS NOT NULL) AS source_ranks
    FROM sent_alerts WHERE source='EBAY'
  `).get() as Record<string, number>;
  return {
    location: 'sent_alerts', records: row.records, distinctListingIds: row.distinct_ids,
    fields: {
      listing_title: row.titles, listing_price: row.prices, listing_currency: row.currencies,
      price_delta: row.comparisons, listing_url: row.urls, listing_posted_at: row.posted,
      alert_latency_seconds: row.latency, source_first_seen_at: row.first_seen, source_last_seen_at: row.last_seen
    },
    ambiguousRetained: { match_score: row.match_scores, source_rank: row.source_ranks }
  };
}

function observationManifest(database: Database.Database): CleanupManifestEntry {
  const row = database.prepare(`
    SELECT COUNT(*) AS records, COUNT(DISTINCT listing_id) AS distinct_ids,
      SUM(listing_title IS NOT NULL) AS titles, SUM(listing_price IS NOT NULL) AS prices,
      SUM(listing_currency IS NOT NULL) AS currencies, SUM(listing_posted_at IS NOT NULL) AS posted,
      SUM(source_rank IS NOT NULL) AS source_ranks
    FROM source_observations WHERE source='EBAY'
  `).get() as Record<string, number>;
  return {
    location: 'source_observations', records: row.records, distinctListingIds: row.distinct_ids,
    fields: { listing_title: row.titles, listing_price: row.prices, listing_currency: row.currencies, listing_posted_at: row.posted },
    ambiguousRetained: { source_rank: row.source_ranks }
  };
}

function simpleManifest(
  database: Database.Database,
  location: string,
  recordWhere: string,
  fieldExpressions: Record<string, string>
): CleanupManifestEntry {
  const fields = Object.entries(fieldExpressions);
  const row = database.prepare(`SELECT COUNT(*) AS records${fields.map(([key, expression]) => `, SUM(${expression}) AS ${key}`).join(' ')} FROM ${location} ${recordWhere}`).get() as Record<string, number>;
  return {
    location,
    records: row.records,
    fields: Object.fromEntries(fields.map(([key]) => [key, Number(row[key] ?? 0)])),
    ambiguousRetained: {}
  };
}

type DiscoveryJsonCounts = {
  prepared: number;
  scheduled: number;
  cardUniverse: number;
  userUniverse: number;
  preparedEvidence: number;
  scheduledEvidence: number;
  cardUniverseEvidence: number;
  userUniverseEvidence: number;
};

function collectManifest(database: Database.Database, jsonCounts: DiscoveryJsonCounts): CleanupManifestEntry[] {
  const scheduledEbayListing = `(json_extract(suggestion_json, '$.listing.source') = 'EBAY' OR listing_id LIKE 'v1|%|%')`;
  const scheduledEbayMarket = `(json_extract(suggestion_json, '$.listing.source') IS NULL OR json_extract(suggestion_json, '$.listing.source') = 'EBAY')`;
  const universeEbayMarket = `(COALESCE(json_extract(suggestion_json, '$.listing.source') = 'EBAY', 0) OR
    (json_extract(suggestion_json, '$.listing.source') IS NULL AND (
      json_type(suggestion_json, '$.typicalRawAskingTotal') IS NOT NULL OR
      json_type(suggestion_json, '$.typicalRawSoldTotal') IS NOT NULL OR
      json_type(suggestion_json, '$.marketContentRetrievedAt') IS NOT NULL)))`;
  return [
    alertManifest(database),
    sentAlertManifest(database),
    observationManifest(database),
    simpleManifest(database, 'discovery_market_cache', '', {
      listing_title: 'listing_title IS NOT NULL', listing_url: 'listing_url IS NOT NULL', image_url: 'image_url IS NOT NULL',
      asking_aggregates: 'typical_raw_asking_total IS NOT NULL OR asking_range_low IS NOT NULL OR asking_range_high IS NOT NULL',
      sold_aggregates: 'typical_raw_sold_total IS NOT NULL OR sold_range_low IS NOT NULL OR sold_range_high IS NOT NULL',
      sample_counts: 'market_sample_size IS NOT NULL OR sold_sample_size IS NOT NULL', retrieval_times: "fetched_at <> ''"
    }),
    simpleManifest(database, 'discovery_scheduled_drop_items', '', {
      listing_title: `listing_title IS NOT NULL AND ${scheduledEbayListing}`,
      listing_url: `listing_url IS NOT NULL AND ${scheduledEbayListing}`,
      market_images: "image_source_kind='MARKET_LISTING' AND lower(COALESCE(image_source_name, '')) LIKE '%ebay%'",
      asking_aggregates: `${scheduledEbayMarket} AND (asking_total IS NOT NULL OR asking_range_low IS NOT NULL OR asking_range_high IS NOT NULL)`,
      sold_aggregates: `${scheduledEbayMarket} AND (sold_total IS NOT NULL OR sold_range_low IS NOT NULL OR sold_range_high IS NOT NULL)`,
      sample_counts: `${scheduledEbayMarket} AND (asking_sample_size IS NOT NULL OR sold_sample_size IS NOT NULL)`,
      market_times: `${scheduledEbayMarket} AND market_updated_at IS NOT NULL`
    }),
    {
      location: 'weekly_discovery_prepared_reserve', records: tableCount(database, 'weekly_discovery_prepared_reserve'),
      fields: { marketplace_json_items: jsonCounts.prepared }, ambiguousRetained: { recommendation_evidence: jsonCounts.preparedEvidence }
    },
    simpleManifest(database, 'discovery_card_universe', '', {
      market_totals_confirmed_ebay: `market_total IS NOT NULL AND ${universeEbayMarket}`,
      ebay_images: "lower(COALESCE(image_source_name, '')) LIKE '%ebay%'",
      marketplace_json_items: `${jsonCounts.cardUniverse}`
    }),
    simpleManifest(database, 'discovery_user_universe', '', {
      market_totals_confirmed_ebay: `market_total IS NOT NULL AND ${universeEbayMarket}`,
      ebay_images: "lower(COALESCE(image_source_name, '')) LIKE '%ebay%'",
      marketplace_json_items: `${jsonCounts.userUniverse}`
    }),
    {
      location: 'discovery_scheduled_drop_items.suggestion_json', records: tableCount(database, 'discovery_scheduled_drop_items'),
      fields: { marketplace_json_items: jsonCounts.scheduled }, ambiguousRetained: { recommendation_evidence: jsonCounts.scheduledEvidence }
    }
  ].map((entry) => {
    if (entry.location === 'discovery_card_universe') {
      entry.fields.marketplace_json_items = jsonCounts.cardUniverse;
      entry.ambiguousRetained.recommendation_evidence = jsonCounts.cardUniverseEvidence;
      entry.ambiguousRetained.market_totals_confirmed_non_ebay = scalar(database, `SELECT COUNT(*) AS value FROM discovery_card_universe WHERE market_total IS NOT NULL AND json_extract(suggestion_json, '$.listing.source') IS NOT NULL AND json_extract(suggestion_json, '$.listing.source') <> 'EBAY'`);
      entry.ambiguousRetained.market_totals_ambiguous = scalar(database, `SELECT COUNT(*) AS value FROM discovery_card_universe WHERE market_total IS NOT NULL AND NOT ${universeEbayMarket} AND json_extract(suggestion_json, '$.listing.source') IS NULL`);
    }
    if (entry.location === 'discovery_user_universe') {
      entry.fields.marketplace_json_items = jsonCounts.userUniverse;
      entry.ambiguousRetained.recommendation_evidence = jsonCounts.userUniverseEvidence;
      entry.ambiguousRetained.market_totals_confirmed_non_ebay = scalar(database, `SELECT COUNT(*) AS value FROM discovery_user_universe WHERE market_total IS NOT NULL AND json_extract(suggestion_json, '$.listing.source') IS NOT NULL AND json_extract(suggestion_json, '$.listing.source') <> 'EBAY'`);
      entry.ambiguousRetained.market_totals_ambiguous = scalar(database, `SELECT COUNT(*) AS value FROM discovery_user_universe WHERE market_total IS NOT NULL AND NOT ${universeEbayMarket} AND json_extract(suggestion_json, '$.listing.source') IS NULL`);
    }
    return entry;
  });
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

const candidateMarketKeys = [
  'listingTitle', 'listingUrl', 'typicalRawAskingTotal', 'typicalRawSoldTotal',
  'askingRangeLow', 'askingRangeHigh', 'soldRangeLow', 'soldRangeHigh',
  'marketSampleSize', 'soldSampleSize', 'marketContentRetrievedAt'
];

function explicitListingSource(value: JsonObject): string | undefined {
  if (!isObject(value.listing) || typeof value.listing.source !== 'string') return undefined;
  return value.listing.source.trim().toUpperCase();
}

function hasRestfulEbayListingId(value: JsonObject): boolean {
  if (!isObject(value.listing)) return false;
  const listingId = value.listing.listingId;
  return typeof listingId === 'string' && /^v1\|[^|]+\|[^|]+$/.test(listingId);
}

function hasConfirmedEbayCandidateMarket(value: JsonObject): boolean {
  const source = explicitListingSource(value);
  if (source && source !== 'EBAY') return false;
  return source === 'EBAY' || hasRestfulEbayListingId(value) || candidateMarketKeys.some((key) => key in value);
}

function sanitizeDiscoveryValue(value: unknown): { value: unknown; changed: boolean } {
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const sanitized = sanitizeDiscoveryValue(item);
      changed ||= sanitized.changed;
      return sanitized.value;
    });
    return { value: next, changed };
  }
  if (!isObject(value)) return { value, changed: false };
  const next: JsonObject = { ...value };
  let changed = false;
  const confirmedEbayMarket = hasConfirmedEbayCandidateMarket(next);
  if (confirmedEbayMarket) {
    for (const key of candidateMarketKeys) {
      if (key in next) {
        delete next[key];
        changed = true;
      }
    }
  }
  if (isObject(next.listing) && (explicitListingSource(next) === 'EBAY' || hasRestfulEbayListingId(next))) {
    const preservedListing = Object.fromEntries(Object.entries(next.listing).filter(([key]) => key === 'listingId' || key === 'source'));
    if (Object.keys(next.listing).some((key) => key !== 'listingId' && key !== 'source')) changed = true;
    next.listing = preservedListing;
  }
  if (isObject(next.image) && next.image.sourceKind === 'MARKET_LISTING'
    && (confirmedEbayMarket || (typeof next.image.sourceName === 'string' && /ebay/i.test(next.image.sourceName)))) {
    delete next.image;
    changed = true;
  }
  for (const [key, nested] of Object.entries(next)) {
    if (key === 'listing' || key === 'image') continue;
    const sanitized = sanitizeDiscoveryValue(nested);
    if (sanitized.changed) {
      next[key] = sanitized.value;
      changed = true;
    }
  }
  return { value: next, changed };
}

function sanitizeAlertPayload(payload: string | null): { value: string | null; changed: boolean } {
  if (!payload) return { value: payload, changed: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new Error('Invalid alert_events.payload_json encountered; cleanup aborted');
  }
  if (!isObject(parsed)) return { value: payload, changed: false };
  const next = structuredClone(parsed);
  let changed = false;
  for (const key of ['listingTitle', 'listingPrice', 'listingCurrency', 'priceDelta', 'listingUrl', 'listingImageUrl', 'listingPostedAt']) {
    if (key in next) {
      delete next[key];
      changed = true;
    }
  }
  if (isObject(next.details)) {
    for (const key of ['pricing', 'listing']) {
      if (key in next.details) {
        delete next.details[key];
        changed = true;
      }
    }
  }
  return { value: changed ? JSON.stringify(next) : payload, changed };
}

function countEvidence(value: unknown): number {
  if (Array.isArray(value)) return value.reduce((total, item) => total + countEvidence(item), 0);
  if (!isObject(value)) return 0;
  return Object.entries(value).reduce((total, [key, nested]) =>
    total + (['recommendationEvidence', 'rankExplanation', 'recommendationReason', 'sourceRank', 'matchScore'].includes(key) ? 1 : 0) + countEvidence(nested), 0);
}

function countJsonChanges(database: Database.Database): DiscoveryJsonCounts {
  let prepared = 0;
  let preparedEvidence = 0;
  for (const row of database.prepare('SELECT reserve_json FROM weekly_discovery_prepared_reserve').iterate() as Iterable<{ reserve_json: string }>) {
    let parsed: unknown;
    try { parsed = JSON.parse(row.reserve_json); } catch { throw new Error('Invalid weekly_discovery_prepared_reserve.reserve_json encountered; cleanup aborted'); }
    if (sanitizeDiscoveryValue(parsed).changed) prepared += 1;
    preparedEvidence += countEvidence(parsed);
  }
  let scheduled = 0;
  let scheduledEvidence = 0;
  for (const row of database.prepare('SELECT suggestion_json FROM discovery_scheduled_drop_items').iterate() as Iterable<{ suggestion_json: string }>) {
    let parsed: unknown;
    try { parsed = JSON.parse(row.suggestion_json); } catch { throw new Error('Invalid discovery_scheduled_drop_items.suggestion_json encountered; cleanup aborted'); }
    if (sanitizeDiscoveryValue(parsed).changed) scheduled += 1;
    scheduledEvidence += countEvidence(parsed);
  }
  const countUniverse = (table: 'discovery_card_universe' | 'discovery_user_universe') => {
    let changed = 0;
    let evidence = 0;
    for (const row of database.prepare(`SELECT suggestion_json FROM ${table}`).iterate() as Iterable<{ suggestion_json: string }>) {
      let parsed: unknown;
      try { parsed = JSON.parse(row.suggestion_json); } catch { throw new Error(`Invalid ${table}.suggestion_json encountered; cleanup aborted`); }
      if (sanitizeDiscoveryValue(parsed).changed) changed += 1;
      evidence += countEvidence(parsed);
    }
    return { changed, evidence };
  };
  const card = countUniverse('discovery_card_universe');
  const user = countUniverse('discovery_user_universe');
  return {
    prepared, scheduled, cardUniverse: card.changed, userUniverse: user.changed,
    preparedEvidence, scheduledEvidence, cardUniverseEvidence: card.evidence, userUniverseEvidence: user.evidence
  };
}

function preservationSnapshot(database: Database.Database): Record<string, number> {
  return {
    alert_events: tableCount(database, 'alert_events'),
    alert_reviewed: scalar(database, 'SELECT COUNT(*) AS value FROM alert_events WHERE reviewed_at IS NOT NULL'),
    alert_dismissed: scalar(database, 'SELECT COUNT(*) AS value FROM alert_events WHERE dismissed_at IS NOT NULL'),
    alert_listing_ids: scalar(database, 'SELECT COUNT(DISTINCT listing_id) AS value FROM alert_events'),
    sent_alerts: tableCount(database, 'sent_alerts'),
    source_observations: tableCount(database, 'source_observations'),
    scheduled_items: tableCount(database, 'discovery_scheduled_drop_items'),
    prepared_reserves: tableCount(database, 'weekly_discovery_prepared_reserve'),
    card_universe: tableCount(database, 'discovery_card_universe'),
    user_universe: tableCount(database, 'discovery_user_universe')
  };
}

function applyJsonCleanup(database: Database.Database): void {
  const updateAlert = database.prepare('UPDATE alert_events SET payload_json = ? WHERE id = ?');
  for (const row of database.prepare("SELECT id, payload_json FROM alert_events WHERE source='EBAY' AND payload_json IS NOT NULL").all() as Array<{ id: string; payload_json: string }>) {
    const sanitized = sanitizeAlertPayload(row.payload_json);
    if (sanitized.changed) updateAlert.run(sanitized.value, row.id);
  }
  const updateReserve = database.prepare('UPDATE weekly_discovery_prepared_reserve SET reserve_json = ? WHERE user_id = ? AND period_key = ?');
  for (const row of database.prepare('SELECT user_id, period_key, reserve_json FROM weekly_discovery_prepared_reserve').all() as Array<{ user_id: string; period_key: string; reserve_json: string }>) {
    const parsed = JSON.parse(row.reserve_json) as unknown;
    const sanitized = sanitizeDiscoveryValue(parsed);
    if (sanitized.changed) updateReserve.run(JSON.stringify(sanitized.value), row.user_id, row.period_key);
  }
  const updateItem = database.prepare('UPDATE discovery_scheduled_drop_items SET suggestion_json = ? WHERE user_id = ? AND drop_type = ? AND period_key = ? AND position = ?');
  for (const row of database.prepare('SELECT user_id, drop_type, period_key, position, suggestion_json FROM discovery_scheduled_drop_items').all() as Array<{ user_id: string; drop_type: string; period_key: string; position: number; suggestion_json: string }>) {
    const parsed = JSON.parse(row.suggestion_json) as unknown;
    const sanitized = sanitizeDiscoveryValue(parsed);
    if (sanitized.changed) updateItem.run(JSON.stringify(sanitized.value), row.user_id, row.drop_type, row.period_key, row.position);
  }
  const updateCard = database.prepare('UPDATE discovery_card_universe SET suggestion_json = ? WHERE card_key = ?');
  for (const row of database.prepare('SELECT card_key, suggestion_json FROM discovery_card_universe').all() as Array<{ card_key: string; suggestion_json: string }>) {
    const sanitized = sanitizeDiscoveryValue(JSON.parse(row.suggestion_json));
    if (sanitized.changed) updateCard.run(JSON.stringify(sanitized.value), row.card_key);
  }
  const updateUser = database.prepare('UPDATE discovery_user_universe SET suggestion_json = ? WHERE user_id = ? AND card_key = ?');
  for (const row of database.prepare('SELECT user_id, card_key, suggestion_json FROM discovery_user_universe').all() as Array<{ user_id: string; card_key: string; suggestion_json: string }>) {
    const sanitized = sanitizeDiscoveryValue(JSON.parse(row.suggestion_json));
    if (sanitized.changed) updateUser.run(JSON.stringify(sanitized.value), row.user_id, row.card_key);
  }
}

function applySqlCleanup(database: Database.Database): void {
  database.exec(`
    UPDATE alert_events SET
      listing_title=NULL, listing_price=NULL, listing_currency=NULL, price_delta=NULL,
      listing_url=NULL, listing_image_url=NULL, listing_posted_at=NULL,
      alert_latency_seconds=NULL, source_first_seen_at=NULL, source_last_seen_at=NULL,
      listing_content_retrieved_at=NULL
    WHERE source='EBAY';
    UPDATE sent_alerts SET
      listing_title=NULL, listing_price=NULL, listing_currency=NULL, price_delta=NULL,
      listing_url=NULL, listing_posted_at=NULL, alert_latency_seconds=NULL,
      source_first_seen_at=NULL, source_last_seen_at=NULL
    WHERE source='EBAY';
    UPDATE source_observations SET
      listing_title=NULL, listing_price=NULL, listing_currency=NULL, listing_posted_at=NULL
    WHERE source='EBAY';
    UPDATE discovery_market_cache SET
      listing_title=NULL, listing_url=NULL, image_url=NULL,
      typical_raw_asking_total=NULL, market_sample_size=NULL,
      typical_raw_sold_total=NULL, sold_sample_size=NULL,
      asking_range_low=NULL, asking_range_high=NULL, sold_range_low=NULL, sold_range_high=NULL,
      fetched_at='';
    UPDATE discovery_scheduled_drop_items SET
      listing_title=CASE WHEN json_extract(suggestion_json, '$.listing.source')='EBAY' OR listing_id LIKE 'v1|%|%' THEN NULL ELSE listing_title END,
      listing_url=CASE WHEN json_extract(suggestion_json, '$.listing.source')='EBAY' OR listing_id LIKE 'v1|%|%' THEN NULL ELSE listing_url END,
      image_url=CASE WHEN image_source_kind='MARKET_LISTING' AND lower(COALESCE(image_source_name, '')) LIKE '%ebay%' THEN NULL ELSE image_url END,
      image_source_name=CASE WHEN image_source_kind='MARKET_LISTING' AND lower(COALESCE(image_source_name, '')) LIKE '%ebay%' THEN NULL ELSE image_source_name END,
      image_source_kind=CASE WHEN image_source_kind='MARKET_LISTING' AND lower(COALESCE(image_source_name, '')) LIKE '%ebay%' THEN NULL ELSE image_source_kind END,
      asking_total=CASE WHEN json_extract(suggestion_json, '$.listing.source') IS NULL OR json_extract(suggestion_json, '$.listing.source')='EBAY' THEN NULL ELSE asking_total END,
      asking_sample_size=CASE WHEN json_extract(suggestion_json, '$.listing.source') IS NULL OR json_extract(suggestion_json, '$.listing.source')='EBAY' THEN NULL ELSE asking_sample_size END,
      sold_total=CASE WHEN json_extract(suggestion_json, '$.listing.source') IS NULL OR json_extract(suggestion_json, '$.listing.source')='EBAY' THEN NULL ELSE sold_total END,
      sold_sample_size=CASE WHEN json_extract(suggestion_json, '$.listing.source') IS NULL OR json_extract(suggestion_json, '$.listing.source')='EBAY' THEN NULL ELSE sold_sample_size END,
      asking_range_low=CASE WHEN json_extract(suggestion_json, '$.listing.source') IS NULL OR json_extract(suggestion_json, '$.listing.source')='EBAY' THEN NULL ELSE asking_range_low END,
      asking_range_high=CASE WHEN json_extract(suggestion_json, '$.listing.source') IS NULL OR json_extract(suggestion_json, '$.listing.source')='EBAY' THEN NULL ELSE asking_range_high END,
      sold_range_low=CASE WHEN json_extract(suggestion_json, '$.listing.source') IS NULL OR json_extract(suggestion_json, '$.listing.source')='EBAY' THEN NULL ELSE sold_range_low END,
      sold_range_high=CASE WHEN json_extract(suggestion_json, '$.listing.source') IS NULL OR json_extract(suggestion_json, '$.listing.source')='EBAY' THEN NULL ELSE sold_range_high END,
      market_updated_at=CASE WHEN json_extract(suggestion_json, '$.listing.source') IS NULL OR json_extract(suggestion_json, '$.listing.source')='EBAY' THEN NULL ELSE market_updated_at END;
    UPDATE discovery_card_universe SET
      market_total=CASE WHEN (json_extract(suggestion_json, '$.listing.source') IS NULL OR json_extract(suggestion_json, '$.listing.source')='EBAY') AND (json_extract(suggestion_json, '$.listing.source')='EBAY'
        OR json_type(suggestion_json, '$.typicalRawAskingTotal') IS NOT NULL
        OR json_type(suggestion_json, '$.typicalRawSoldTotal') IS NOT NULL
        OR json_type(suggestion_json, '$.marketContentRetrievedAt') IS NOT NULL) THEN NULL ELSE market_total END,
      market_currency=CASE WHEN (json_extract(suggestion_json, '$.listing.source') IS NULL OR json_extract(suggestion_json, '$.listing.source')='EBAY') AND (json_extract(suggestion_json, '$.listing.source')='EBAY'
        OR json_type(suggestion_json, '$.typicalRawAskingTotal') IS NOT NULL
        OR json_type(suggestion_json, '$.typicalRawSoldTotal') IS NOT NULL
        OR json_type(suggestion_json, '$.marketContentRetrievedAt') IS NOT NULL) THEN NULL ELSE market_currency END,
      image_url=CASE WHEN lower(COALESCE(image_source_name, '')) LIKE '%ebay%' THEN NULL ELSE image_url END,
      source_card_id=CASE WHEN lower(COALESCE(image_source_name, '')) LIKE '%ebay%' THEN NULL ELSE source_card_id END,
      image_source_name=CASE WHEN lower(COALESCE(image_source_name, '')) LIKE '%ebay%' THEN NULL ELSE image_source_name END;
    UPDATE discovery_user_universe SET
      market_total=CASE WHEN (json_extract(suggestion_json, '$.listing.source') IS NULL OR json_extract(suggestion_json, '$.listing.source')='EBAY') AND (json_extract(suggestion_json, '$.listing.source')='EBAY'
        OR json_type(suggestion_json, '$.typicalRawAskingTotal') IS NOT NULL
        OR json_type(suggestion_json, '$.typicalRawSoldTotal') IS NOT NULL
        OR json_type(suggestion_json, '$.marketContentRetrievedAt') IS NOT NULL) THEN NULL ELSE market_total END,
      market_currency=CASE WHEN (json_extract(suggestion_json, '$.listing.source') IS NULL OR json_extract(suggestion_json, '$.listing.source')='EBAY') AND (json_extract(suggestion_json, '$.listing.source')='EBAY'
        OR json_type(suggestion_json, '$.typicalRawAskingTotal') IS NOT NULL
        OR json_type(suggestion_json, '$.typicalRawSoldTotal') IS NOT NULL
        OR json_type(suggestion_json, '$.marketContentRetrievedAt') IS NOT NULL) THEN NULL ELSE market_currency END,
      image_url=CASE WHEN lower(COALESCE(image_source_name, '')) LIKE '%ebay%' THEN NULL ELSE image_url END,
      source_card_id=CASE WHEN lower(COALESCE(image_source_name, '')) LIKE '%ebay%' THEN NULL ELSE source_card_id END,
      image_source_name=CASE WHEN lower(COALESCE(image_source_name, '')) LIKE '%ebay%' THEN NULL ELSE image_source_name END;
  `);
}

export function runPhase3cEbayCleanup(database: Database.Database, apply = false): Phase3cCleanupReport {
  assertSchema(database);
  const jsonBefore = countJsonChanges(database);
  const before = collectManifest(database, jsonBefore);
  const preserved = preservationSnapshot(database);
  if (!apply) {
    const snapshotDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'keepseek-phase3c-'));
    fs.chmodSync(snapshotDirectory, 0o700);
    const snapshotPath = path.join(snapshotDirectory, 'projection.db');
    let projection: Database.Database | undefined;
    try {
      database.prepare('VACUUM INTO ?').run(snapshotPath);
      fs.chmodSync(snapshotPath, 0o600);
      projection = new Database(snapshotPath, { fileMustExist: true });
      projection.pragma('foreign_keys = ON');
      applySqlCleanup(projection);
      applyJsonCleanup(projection);
      const after = collectManifest(projection, countJsonChanges(projection));
      return { mode: 'DRY_RUN', before, after, preserved };
    } finally {
      projection?.close();
      fs.rmSync(snapshotDirectory, { recursive: true, force: true });
    }
  }

  database.pragma('busy_timeout = 5000');
  database.exec('BEGIN IMMEDIATE');
  try {
    applySqlCleanup(database);
    applyJsonCleanup(database);
    const afterPreserved = preservationSnapshot(database);
    if (JSON.stringify(afterPreserved) !== JSON.stringify(preserved)) throw new Error('Collector-data preservation check failed');
    const foreignKeys = database.pragma('foreign_key_check') as unknown[];
    if (foreignKeys.length > 0) throw new Error(`Foreign-key check failed with ${foreignKeys.length} violation(s)`);
    const integrity = database.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') throw new Error(`SQLite integrity check failed: ${String(integrity)}`);
    const after = collectManifest(database, countJsonChanges(database));
    if (after.some((entry) => Object.values(entry.fields).some((count) => count !== 0))) {
      throw new Error('Cleanup validation failed: targeted marketplace content remains');
    }
    database.exec('COMMIT');
    return { mode: 'APPLY', before, after, preserved };
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}
