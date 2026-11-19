import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { runPhase3cEbayCleanup } from '../phase3c-ebay-cleanup.js';

function fixtureDatabase(filename: string | Buffer = ':memory:', wal = false): Database.Database {
  const database = new Database(filename);
  if (wal) database.pragma('journal_mode = WAL');
  database.exec(`
    CREATE TABLE alert_events (
      id TEXT PRIMARY KEY, source TEXT, listing_id TEXT, listing_title TEXT, listing_price REAL,
      listing_currency TEXT, price_delta REAL, listing_url TEXT, listing_image_url TEXT,
      listing_posted_at TEXT, alert_latency_seconds INTEGER, source_first_seen_at TEXT,
      source_last_seen_at TEXT, listing_content_retrieved_at TEXT, match_score INTEGER,
      source_rank INTEGER, payload_json TEXT, reviewed_at TEXT, dismissed_at TEXT
    );
    CREATE TABLE sent_alerts (
      chase_id TEXT, listing_id TEXT, source TEXT, listing_title TEXT, listing_price REAL,
      listing_currency TEXT, price_delta REAL, listing_url TEXT, listing_posted_at TEXT,
      alert_latency_seconds INTEGER, source_first_seen_at TEXT, source_last_seen_at TEXT,
      match_score INTEGER, source_rank INTEGER, PRIMARY KEY (chase_id, listing_id, source)
    );
    CREATE TABLE source_observations (
      chase_id TEXT, listing_id TEXT, source TEXT, listing_title TEXT, listing_price REAL,
      listing_currency TEXT, listing_posted_at TEXT, source_rank INTEGER,
      PRIMARY KEY (chase_id, listing_id, source)
    );
    CREATE TABLE discovery_market_cache (
      cache_key TEXT PRIMARY KEY, listing_id TEXT, listing_title TEXT, listing_url TEXT, image_url TEXT,
      typical_raw_asking_total REAL, asking_range_low REAL, asking_range_high REAL, market_sample_size INTEGER,
      typical_raw_sold_total REAL, sold_range_low REAL, sold_range_high REAL, sold_sample_size INTEGER,
      fetched_at TEXT
    );
    CREATE TABLE discovery_scheduled_drop_items (
      user_id TEXT, drop_type TEXT, period_key TEXT, position INTEGER, suggestion_json TEXT,
      image_url TEXT, image_source_name TEXT, image_source_kind TEXT, listing_id TEXT,
      listing_title TEXT, listing_url TEXT, asking_total REAL, asking_range_low REAL,
      asking_range_high REAL, asking_sample_size INTEGER, sold_total REAL, sold_range_low REAL,
      sold_range_high REAL, sold_sample_size INTEGER, market_updated_at TEXT,
      PRIMARY KEY (user_id, drop_type, period_key, position)
    );
    CREATE TABLE weekly_discovery_prepared_reserve (
      user_id TEXT, period_key TEXT, reserve_json TEXT, PRIMARY KEY (user_id, period_key)
    );
    CREATE TABLE discovery_card_universe (
      card_key TEXT PRIMARY KEY, suggestion_json TEXT, market_total REAL, market_currency TEXT, image_url TEXT,
      image_source_name TEXT, source_card_id TEXT
    );
    CREATE TABLE discovery_user_universe (
      user_id TEXT, card_key TEXT, suggestion_json TEXT, market_total REAL, market_currency TEXT, image_url TEXT,
      image_source_name TEXT, source_card_id TEXT, PRIMARY KEY (user_id, card_key)
    );
  `);
  const payload = JSON.stringify({
    listingTitle: 'Market title', listingPrice: 12, listingUrl: 'https://example.test/item',
    details: {
      pricing: { itemPrice: 12 }, listing: { seller: 'seller' },
      match: { reasons: ['card name'] }, chase: { name: 'Collector card' }
    }
  });
  database.prepare(`INSERT INTO alert_events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    'alert-ebay', 'EBAY', 'v1|123|0', 'Market title', 12, 'CAD', 3, 'https://example.test/item',
    'https://example.test/image.jpg', '2026-01-01', 2, '2026-01-01', '2026-01-01', '2026-01-01',
    91, 1, payload, '2026-01-02', '2026-01-03'
  );
  database.prepare(`INSERT INTO alert_events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    'alert-shop', 'SHOPIFY', 'variant-1', 'Shop title', 20, 'CAD', 4, 'https://shop.test/item',
    'https://shop.test/image.jpg', null, null, null, null, '2026-01-01', 88, 2, payload, null, null
  );
  database.prepare(`INSERT INTO sent_alerts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    'chase-1', 'v1|123|0', 'EBAY', 'Market title', 12, 'CAD', 3, 'https://example.test/item',
    '2026-01-01', 2, '2026-01-01', '2026-01-01', 91, 1
  );
  database.prepare(`INSERT INTO source_observations VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    'chase-1', 'v1|123|0', 'EBAY', 'Market title', 12, 'CAD', '2026-01-01', 1
  );
  database.prepare(`INSERT INTO discovery_market_cache VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    'cache-1', 'v1|123|0', 'Market title', 'https://example.test/item', 'https://example.test/image.jpg',
    12, 10, 14, 3, 11, 9, 13, 2, '2026-01-01'
  );
  const suggestion = JSON.stringify({
    name: 'Card A', listing: { listingId: 'v1|123|0', source: 'EBAY', title: 'Market title', price: 12 },
    image: { sourceKind: 'MARKET_LISTING', url: 'https://example.test/image.jpg' },
    typicalRawAskingTotal: 12, recommendationEvidence: { explanation: 'First-party explanation' }
  });
  database.prepare(`INSERT INTO discovery_scheduled_drop_items VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    'user-1', 'WEEKLY', '2026-W01', 0, suggestion, 'https://example.test/image.jpg', 'eBay', 'MARKET_LISTING',
    'v1|123|0', 'Market title', 'https://example.test/item', 12, 10, 14, 3, 11, 9, 13, 2, '2026-01-01'
  );
  const shopSuggestion = JSON.stringify({
    name: 'Shop card', listing: { listingId: 'variant-1', source: 'SHOPIFY', title: 'Shop listing', price: 25 },
    image: { sourceKind: 'MARKET_LISTING', sourceName: 'Trusted Shop', url: 'https://shop.test/image.jpg' },
    typicalRawAskingTotal: 25
  });
  database.prepare(`INSERT INTO discovery_scheduled_drop_items VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    'user-1', 'WEEKLY', '2026-W01', 1, shopSuggestion, 'https://shop.test/image.jpg', 'Trusted Shop', 'MARKET_LISTING',
    'variant-1', 'Shop listing', 'https://shop.test/item', 25, 24, 26, 2, 23, 22, 24, 2, '2026-01-01'
  );
  database.prepare('INSERT INTO weekly_discovery_prepared_reserve VALUES (?, ?, ?)').run(
    'user-1', '2026-W01', JSON.stringify({ candidates: [JSON.parse(suggestion), JSON.parse(shopSuggestion), {
      name: 'Ambiguous legacy card', listing: { listingId: '123', title: 'Unproven listing' },
      image: { sourceKind: 'MARKET_LISTING', url: 'https://unknown.test/image.jpg' }
    }, { name: 'Catalog card', image: { sourceKind: 'CARD_REFERENCE', url: 'https://catalog.test/card.jpg' } }] })
  );
  database.prepare('INSERT INTO discovery_card_universe VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    'ebay-card', suggestion, 12, 'CAD', 'https://example.test/image.jpg', 'eBay', 'v1|123|0'
  );
  database.prepare('INSERT INTO discovery_card_universe VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    'catalog-card', JSON.stringify({ name: 'Catalog card', image: { sourceKind: 'CARD_REFERENCE', url: 'https://catalog.test/card.jpg' } }), null, null, 'https://catalog.test/card.jpg', 'TCGdex', 'catalog-1'
  );
  database.prepare('INSERT INTO discovery_card_universe VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    'shop-card', shopSuggestion, 25, 'CAD', 'https://shop.test/image.jpg', 'Trusted Shop', 'variant-1'
  );
  database.prepare('INSERT INTO discovery_card_universe VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    'legacy-card', JSON.stringify({ name: 'Legacy card' }), 99, 'CAD', 'https://catalog.test/legacy.jpg', 'TCGdex', 'catalog-legacy'
  );
  database.prepare('INSERT INTO discovery_user_universe VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    'user-1', 'ebay-card', suggestion, 12, 'CAD', 'https://example.test/image.jpg', 'eBay', 'v1|123|0'
  );
  database.prepare('INSERT INTO discovery_user_universe VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    'user-1', 'shop-card', shopSuggestion, 25, 'CAD', 'https://shop.test/image.jpg', 'Trusted Shop', 'variant-1'
  );
  database.prepare('INSERT INTO discovery_user_universe VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    'user-1', 'legacy-card', JSON.stringify({ name: 'Legacy card' }), 99, 'CAD', 'https://catalog.test/legacy.jpg', 'TCGdex', 'catalog-legacy'
  );
  return database;
}

describe('Phase 3C eBay cleanup', () => {
  it('defaults to a non-mutating aggregate dry run', () => {
    const database = fixtureDatabase();
    const report = runPhase3cEbayCleanup(database);
    expect(report.mode).toBe('DRY_RUN');
    expect(report.before.find((entry) => entry.location === 'alert_events')).toMatchObject({
      records: 1, distinctListingIds: 1, fields: { listing_title: 1, marketplace_payload_json: 1 }
    });
    expect(report.before.find((entry) => entry.location === 'discovery_card_universe')).toMatchObject({
      fields: { market_totals_confirmed_ebay: 1 },
      ambiguousRetained: { market_totals_confirmed_non_ebay: 1, market_totals_ambiguous: 1 }
    });
    expect(report.before.find((entry) => entry.location === 'discovery_user_universe')).toMatchObject({
      fields: { market_totals_confirmed_ebay: 1 },
      ambiguousRetained: { market_totals_confirmed_non_ebay: 1, market_totals_ambiguous: 1 }
    });
    expect(database.prepare("SELECT listing_title FROM alert_events WHERE source='EBAY'").get()).toEqual({ listing_title: 'Market title' });
    database.close();
  });

  it('clears eBay content while preserving collector state, identities, shop data, and catalog artwork', () => {
    const database = fixtureDatabase();
    const report = runPhase3cEbayCleanup(database, true);
    expect(report.mode).toBe('APPLY');
    expect(report.after.every((entry) => Object.values(entry.fields).every((count) => count === 0))).toBe(true);
    const alert = database.prepare("SELECT * FROM alert_events WHERE id='alert-ebay'").get() as Record<string, unknown>;
    expect(alert).toMatchObject({ listing_id: 'v1|123|0', listing_title: null, reviewed_at: '2026-01-02', dismissed_at: '2026-01-03', match_score: 91, source_rank: 1 });
    const payload = JSON.parse(String(alert.payload_json)) as Record<string, any>;
    expect(payload.details).toEqual({ match: { reasons: ['card name'] }, chase: { name: 'Collector card' } });
    expect(database.prepare("SELECT listing_title, listing_price FROM alert_events WHERE id='alert-shop'").get()).toEqual({ listing_title: 'Shop title', listing_price: 20 });
    expect(database.prepare("SELECT listing_id FROM discovery_market_cache").get()).toEqual({ listing_id: 'v1|123|0' });
    expect(database.prepare("SELECT image_url, image_source_name FROM discovery_card_universe WHERE card_key='catalog-card'").get()).toEqual({ image_url: 'https://catalog.test/card.jpg', image_source_name: 'TCGdex' });
    expect(database.prepare("SELECT market_total, market_currency, image_url FROM discovery_card_universe WHERE card_key='shop-card'").get()).toEqual({ market_total: 25, market_currency: 'CAD', image_url: 'https://shop.test/image.jpg' });
    expect(database.prepare("SELECT market_total, market_currency FROM discovery_card_universe WHERE card_key='legacy-card'").get()).toEqual({ market_total: 99, market_currency: 'CAD' });
    expect(database.prepare("SELECT listing_title, asking_total, image_url FROM discovery_scheduled_drop_items WHERE position=1").get()).toEqual({ listing_title: 'Shop listing', asking_total: 25, image_url: 'https://shop.test/image.jpg' });
    const reserve = JSON.parse((database.prepare('SELECT reserve_json FROM weekly_discovery_prepared_reserve').get() as { reserve_json: string }).reserve_json);
    expect(reserve.candidates[0]).toMatchObject({ listing: { listingId: 'v1|123|0', source: 'EBAY' }, recommendationEvidence: { explanation: 'First-party explanation' } });
    expect(reserve.candidates[0].image).toBeUndefined();
    expect(reserve.candidates[1]).toMatchObject({
      listing: { listingId: 'variant-1', source: 'SHOPIFY', title: 'Shop listing', price: 25 },
      image: { sourceKind: 'MARKET_LISTING', sourceName: 'Trusted Shop', url: 'https://shop.test/image.jpg' },
      typicalRawAskingTotal: 25
    });
    expect(reserve.candidates[2]).toMatchObject({ listing: { listingId: '123', title: 'Unproven listing' }, image: { url: 'https://unknown.test/image.jpg' } });
    expect(reserve.candidates[3].image.url).toBe('https://catalog.test/card.jpg');
    database.close();
  });

  it('is idempotent', () => {
    const database = fixtureDatabase();
    runPhase3cEbayCleanup(database, true);
    const second = runPhase3cEbayCleanup(database, true);
    expect(second.before.every((entry) => Object.values(entry.fields).every((count) => count === 0))).toBe(true);
    database.close();
  });

  it('projects the same manifest that apply produces without changing the source database', () => {
    const database = fixtureDatabase();
    const projected = runPhase3cEbayCleanup(database);
    expect(database.prepare("SELECT listing_title FROM alert_events WHERE id='alert-ebay'").get()).toEqual({ listing_title: 'Market title' });
    const applied = runPhase3cEbayCleanup(database, true);
    expect(projected.after).toEqual(applied.after);
    database.close();
  });

  it('projects a read-only file-backed WAL database and matches apply on a copy', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'keepseek-phase3c-test-'));
    const sourcePath = path.join(directory, 'source.db');
    const applyPath = path.join(directory, 'apply.db');
    let source: Database.Database | undefined;
    let applyDatabase: Database.Database | undefined;
    try {
      const setup = fixtureDatabase(sourcePath, true);
      expect(setup.pragma('journal_mode', { simple: true })).toBe('wal');
      setup.close();
      fs.copyFileSync(sourcePath, applyPath);

      source = new Database(sourcePath, { readonly: true, fileMustExist: true });
      const projected = runPhase3cEbayCleanup(source);
      expect(source.prepare("SELECT listing_title FROM alert_events WHERE id='alert-ebay'").get()).toEqual({ listing_title: 'Market title' });
      source.close();
      source = undefined;

      applyDatabase = new Database(applyPath, { fileMustExist: true });
      const applied = runPhase3cEbayCleanup(applyDatabase, true);
      expect(projected.after).toEqual(applied.after);
      const verification = new Database(sourcePath, { readonly: true });
      try {
        expect(verification.prepare("SELECT listing_title FROM alert_events WHERE id='alert-ebay'").pluck().get()).toBe('Market title');
      } finally {
        verification.close();
      }
    } finally {
      source?.close();
      applyDatabase?.close();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rolls back every change when validation or persistence fails', () => {
    const database = fixtureDatabase();
    database.exec(`CREATE TRIGGER fail_sent_cleanup BEFORE UPDATE ON sent_alerts BEGIN SELECT RAISE(ABORT, 'fixture failure'); END;`);
    expect(() => runPhase3cEbayCleanup(database, true)).toThrow('fixture failure');
    expect(database.prepare("SELECT listing_title FROM alert_events WHERE id='alert-ebay'").get()).toEqual({ listing_title: 'Market title' });
    expect(database.prepare("SELECT listing_title FROM sent_alerts WHERE source='EBAY'").get()).toEqual({ listing_title: 'Market title' });
    database.close();
  });
});
