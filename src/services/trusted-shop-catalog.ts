import { randomUUID } from 'node:crypto';
import { db } from './db.js';

export type TrustedShopCatalogCoverage = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETE_OBSERVED' | 'INTERRUPTED' | 'LIMITED_PROVIDER_BOUNDARY';

export type TrustedShopCatalogState = {
  shopSlug: string;
  sweepId: string;
  nextPage: number;
  pagesScanned: number;
  productsSeen: number;
  coverageStatus: TrustedShopCatalogCoverage;
  sweepStartedAt?: string;
  lastSuccessfulBatchAt?: string;
  lastCompletedSweepAt?: string;
  lastCompletedPages?: number;
  lastCompletedProducts?: number;
  nextRunAt: string;
  retryCount: number;
  lastError?: string;
  lastRevalidationAt?: string;
  revalidationSuccesses: number;
  revalidationUnavailable: number;
  revalidationFailures: number;
  updatedAt: string;
};

type CatalogStateRow = {
  shop_slug: string;
  sweep_id: string;
  next_page: number;
  pages_scanned: number;
  products_seen: number;
  coverage_status: TrustedShopCatalogCoverage;
  sweep_started_at: string | null;
  last_successful_batch_at: string | null;
  last_completed_sweep_at: string | null;
  last_completed_pages: number | null;
  last_completed_products: number | null;
  next_run_at: string;
  retry_count: number;
  last_error: string | null;
  last_revalidation_at: string | null;
  revalidation_successes: number;
  revalidation_unavailable: number;
  revalidation_failures: number;
  updated_at: string;
};

function mapState(row: CatalogStateRow): TrustedShopCatalogState {
  return {
    shopSlug: row.shop_slug,
    sweepId: row.sweep_id,
    nextPage: row.next_page,
    pagesScanned: row.pages_scanned,
    productsSeen: row.products_seen,
    coverageStatus: row.coverage_status,
    sweepStartedAt: row.sweep_started_at ?? undefined,
    lastSuccessfulBatchAt: row.last_successful_batch_at ?? undefined,
    lastCompletedSweepAt: row.last_completed_sweep_at ?? undefined,
    lastCompletedPages: row.last_completed_pages ?? undefined,
    lastCompletedProducts: row.last_completed_products ?? undefined,
    nextRunAt: row.next_run_at,
    retryCount: row.retry_count,
    lastError: row.last_error ?? undefined,
    lastRevalidationAt: row.last_revalidation_at ?? undefined,
    revalidationSuccesses: row.revalidation_successes,
    revalidationUnavailable: row.revalidation_unavailable,
    revalidationFailures: row.revalidation_failures,
    updatedAt: row.updated_at
  };
}

const selectState = db.prepare('SELECT * FROM trusted_shop_catalog_state WHERE shop_slug = ?');

export function ensureTrustedShopCatalogState(shopSlug: string, now = new Date().toISOString()): TrustedShopCatalogState {
  db.prepare(`
    INSERT OR IGNORE INTO trusted_shop_catalog_state (
      shop_slug, sweep_id, next_page, pages_scanned, products_seen, coverage_status,
      next_run_at, retry_count, updated_at
    ) VALUES (?, ?, 1, 0, 0, 'NOT_STARTED', ?, 0, ?)
  `).run(shopSlug, randomUUID(), now, now);
  return mapState(selectState.get(shopSlug) as CatalogStateRow);
}

export function getTrustedShopCatalogState(shopSlug: string): TrustedShopCatalogState | undefined {
  const row = selectState.get(shopSlug) as CatalogStateRow | undefined;
  return row ? mapState(row) : undefined;
}

export function listTrustedShopCatalogStates(): TrustedShopCatalogState[] {
  return (db.prepare('SELECT * FROM trusted_shop_catalog_state ORDER BY shop_slug').all() as CatalogStateRow[]).map(mapState);
}

export function trustedShopCatalogBatchDue(state: TrustedShopCatalogState, nowMs = Date.now()): boolean {
  if (state.coverageStatus === 'LIMITED_PROVIDER_BOUNDARY') return false;
  return Date.parse(state.nextRunAt) <= nowMs;
}

export type IndexedTrustedShopProduct = {
  id: number;
  handle?: string | null;
  title?: string | null;
  [key: string]: unknown;
};

export function commitTrustedShopCatalogBatch(input: {
  shopSlug: string;
  sweepId: string;
  startPage: number;
  pagesFetched: number;
  products: IndexedTrustedShopProduct[];
  exhausted: boolean;
  now?: string;
  refreshAfterMs?: number;
  nextBatchAfterMs?: number;
}): TrustedShopCatalogState {
  const now = input.now ?? new Date().toISOString();
  const nowMs = Date.parse(now);
  return db.transaction(() => {
    const current = ensureTrustedShopCatalogState(input.shopSlug, now);
    if (current.sweepId !== input.sweepId || current.nextPage !== input.startPage) return current;

    const upsert = db.prepare(`
      INSERT INTO trusted_shop_catalog_products (
        shop_slug, product_id, handle, normalized_title, product_json,
        seen_sweep_id, last_indexed_at, removed_at
      ) VALUES (@shop_slug, @product_id, @handle, @normalized_title, @product_json, @seen_sweep_id, @last_indexed_at, NULL)
      ON CONFLICT(shop_slug, product_id) DO UPDATE SET
        handle = excluded.handle,
        normalized_title = excluded.normalized_title,
        product_json = excluded.product_json,
        seen_sweep_id = excluded.seen_sweep_id,
        last_indexed_at = excluded.last_indexed_at,
        removed_at = NULL
    `);
    for (const product of input.products) {
      if (!product.id || !product.handle) continue;
      upsert.run({
        shop_slug: input.shopSlug,
        product_id: String(product.id),
        handle: product.handle,
        normalized_title: String(product.title ?? '').toLowerCase().replace(/\s+/g, ' ').trim(),
        product_json: JSON.stringify(product),
        seen_sweep_id: input.sweepId,
        last_indexed_at: now
      });
    }

    const pagesScanned = current.pagesScanned + input.pagesFetched;
    const productsSeen = current.productsSeen + input.products.length;
    if (input.exhausted) {
      db.prepare(`
        UPDATE trusted_shop_catalog_products
        SET removed_at = COALESCE(removed_at, ?)
        WHERE shop_slug = ? AND seen_sweep_id != ?
      `).run(now, input.shopSlug, input.sweepId);
      db.prepare(`
        UPDATE trusted_shop_catalog_state
        SET sweep_id = ?, next_page = 1, pages_scanned = 0, products_seen = 0,
            coverage_status = 'COMPLETE_OBSERVED', sweep_started_at = NULL,
            last_successful_batch_at = ?, last_completed_sweep_at = ?,
            last_completed_pages = ?, last_completed_products = ?,
            next_run_at = ?, retry_count = 0, last_error = NULL, updated_at = ?
        WHERE shop_slug = ?
      `).run(
        randomUUID(), now, now, pagesScanned, productsSeen,
        new Date(nowMs + (input.refreshAfterMs ?? 6 * 60 * 60 * 1000)).toISOString(), now, input.shopSlug
      );
    } else {
      db.prepare(`
        UPDATE trusted_shop_catalog_state
        SET next_page = ?, pages_scanned = ?, products_seen = ?, coverage_status = 'IN_PROGRESS',
            sweep_started_at = COALESCE(sweep_started_at, ?), last_successful_batch_at = ?,
            next_run_at = ?, retry_count = 0, last_error = NULL, updated_at = ?
        WHERE shop_slug = ?
      `).run(
        input.startPage + input.pagesFetched, pagesScanned, productsSeen, now, now,
        new Date(nowMs + (input.nextBatchAfterMs ?? 60_000)).toISOString(), now, input.shopSlug
      );
    }
    return mapState(selectState.get(input.shopSlug) as CatalogStateRow);
  })();
}

export function failTrustedShopCatalogBatch(input: {
  shopSlug: string;
  error: string;
  now?: string;
  retryBaseMs?: number;
}): TrustedShopCatalogState {
  const now = input.now ?? new Date().toISOString();
  const current = ensureTrustedShopCatalogState(input.shopSlug, now);
  const retryCount = current.retryCount + 1;
  const retryMs = Math.min(15 * 60_000, (input.retryBaseMs ?? 60_000) * 2 ** Math.min(4, retryCount - 1));
  db.prepare(`
    UPDATE trusted_shop_catalog_state
    SET coverage_status = 'INTERRUPTED', retry_count = ?, last_error = ?, next_run_at = ?, updated_at = ?
    WHERE shop_slug = ?
  `).run(retryCount, input.error.slice(0, 500), new Date(Date.parse(now) + retryMs).toISOString(), now, input.shopSlug);
  return mapState(selectState.get(input.shopSlug) as CatalogStateRow);
}

export function limitTrustedShopCatalogCoverage(input: {
  shopSlug: string;
  reason: string;
  now?: string;
}): TrustedShopCatalogState {
  const now = input.now ?? new Date().toISOString();
  ensureTrustedShopCatalogState(input.shopSlug, now);
  db.prepare(`
    UPDATE trusted_shop_catalog_state
    SET coverage_status = 'LIMITED_PROVIDER_BOUNDARY', retry_count = 0,
        last_error = ?, next_run_at = ?, updated_at = ?
    WHERE shop_slug = ?
  `).run(input.reason.slice(0, 500), now, now, input.shopSlug);
  return mapState(selectState.get(input.shopSlug) as CatalogStateRow);
}

export type TrustedShopCatalogHealth = {
  status: 'HEALTHY' | 'WAITING' | 'LIMITED' | 'STALLED';
  reason: string;
};

export function classifyTrustedShopCatalogHealth(
  state: TrustedShopCatalogState,
  nowMs = Date.now(),
  stallAfterMs = 30 * 60_000
): TrustedShopCatalogHealth {
  if (state.coverageStatus === 'LIMITED_PROVIDER_BOUNDARY') {
    return { status: 'LIMITED', reason: state.lastError ?? 'Provider coverage boundary reached' };
  }
  if (state.coverageStatus === 'COMPLETE_OBSERVED') return { status: 'HEALTHY', reason: 'Observed sweep complete' };
  const progressAt = Date.parse(state.lastSuccessfulBatchAt ?? state.updatedAt);
  if (state.coverageStatus === 'INTERRUPTED' && state.retryCount > 0 && nowMs - progressAt > stallAfterMs) {
    return { status: 'STALLED', reason: state.lastError ?? 'Repeated catalog batch failures' };
  }
  return { status: 'WAITING', reason: state.coverageStatus === 'INTERRUPTED' ? 'Transient retry scheduled' : 'Progressive scan scheduled' };
}

export function findTrustedShopCatalogCandidates(shopSlug: string, searchText: string, limit = 24): IndexedTrustedShopProduct[] {
  const tokens = [...new Set(searchText.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [])].slice(0, 8);
  if (tokens.length === 0) return [];
  const patterns = tokens.map((token) => `%${token}%`);
  const relevance = tokens.map(() => 'CASE WHEN normalized_title LIKE ? THEN 1 ELSE 0 END').join(' + ');
  const matches = tokens.map(() => 'normalized_title LIKE ?').join(' OR ');
  const rows = db.prepare(`
    SELECT product_json FROM trusted_shop_catalog_products
    WHERE shop_slug = ? AND removed_at IS NULL AND (${matches})
    ORDER BY (${relevance}) DESC, last_indexed_at DESC, product_id ASC
    LIMIT ?
  `).all(shopSlug, ...patterns, ...patterns, Math.max(1, Math.min(100, limit))) as Array<{ product_json: string }>;
  return rows.flatMap((row) => {
    try {
      return [JSON.parse(row.product_json) as IndexedTrustedShopProduct];
    } catch {
      return [];
    }
  });
}

export function countTrustedShopCatalogProducts(shopSlug: string): number {
  const row = db.prepare(`
    SELECT COUNT(*) AS count FROM trusted_shop_catalog_products
    WHERE shop_slug = ? AND removed_at IS NULL
  `).get(shopSlug) as { count: number };
  return row.count;
}

export function markTrustedShopCatalogProductUnavailable(shopSlug: string, productId: number, now = new Date().toISOString()): void {
  db.prepare(`UPDATE trusted_shop_catalog_products SET removed_at = ? WHERE shop_slug = ? AND product_id = ?`).run(now, shopSlug, String(productId));
}

export function recordTrustedShopRevalidation(input: {
  shopSlug: string;
  successes: number;
  unavailable: number;
  failures: number;
  now?: string;
}): void {
  const now = input.now ?? new Date().toISOString();
  ensureTrustedShopCatalogState(input.shopSlug, now);
  db.prepare(`
    UPDATE trusted_shop_catalog_state
    SET last_revalidation_at = ?,
        revalidation_successes = revalidation_successes + ?,
        revalidation_unavailable = revalidation_unavailable + ?,
        revalidation_failures = revalidation_failures + ?,
        updated_at = ?
    WHERE shop_slug = ?
  `).run(now, input.successes, input.unavailable, input.failures, now, input.shopSlug);
}
