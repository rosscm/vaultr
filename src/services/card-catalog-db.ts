import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { normalizeCatalogText } from './card-catalog/normalize.js';
import type { CardCatalogImportReport, CardCatalogRecord, CardCatalogStats, StoredCardCatalogRecord } from './card-catalog/types.js';

const DEFAULT_CATALOG_PATH = './data/card-catalog.db';

export function cardCatalogPath(): string {
  return path.resolve(process.env.CARD_CATALOG_PATH ?? DEFAULT_CATALOG_PATH);
}

export function openCardCatalogDb(dbPath = cardCatalogPath(), options: { readonly?: boolean; fileMustExist?: boolean } = {}): Database.Database {
  fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  const db = new Database(path.resolve(dbPath), options);
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  if (!options.readonly) db.pragma('journal_mode = WAL');
  return db;
}

export function initializeCardCatalogDb(dbPath = cardCatalogPath()): void {
  const db = openCardCatalogDb(dbPath);
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS card_catalog_records (
        id INTEGER PRIMARY KEY,
        source TEXT NOT NULL,
        source_card_id TEXT NOT NULL,
        language TEXT NOT NULL,
        name TEXT NOT NULL,
        normalized_name TEXT NOT NULL,
        set_id TEXT,
        set_name TEXT,
        translated_set_name TEXT,
        normalized_set_name TEXT,
        series TEXT,
        card_number TEXT,
        normalized_card_number TEXT,
        printed_total TEXT,
        is_unnumbered INTEGER NOT NULL DEFAULT 0,
        rarity TEXT,
        image_url TEXT,
        release_date TEXT,
        is_promo INTEGER NOT NULL DEFAULT 0,
        promo_context TEXT,
        release_type TEXT,
        release_event TEXT,
        release_year INTEGER,
        verification_status TEXT,
        source_updated_at TEXT,
        imported_at TEXT NOT NULL,
        UNIQUE(source, source_card_id, language)
      );

      CREATE INDEX IF NOT EXISTS idx_card_catalog_normalized_name ON card_catalog_records(normalized_name);
      CREATE INDEX IF NOT EXISTS idx_card_catalog_name_number ON card_catalog_records(normalized_name, normalized_card_number);
      CREATE INDEX IF NOT EXISTS idx_card_catalog_number_total ON card_catalog_records(normalized_card_number, printed_total);
      CREATE INDEX IF NOT EXISTS idx_card_catalog_language ON card_catalog_records(language);
      CREATE INDEX IF NOT EXISTS idx_card_catalog_set_name ON card_catalog_records(normalized_set_name);
      CREATE INDEX IF NOT EXISTS idx_card_catalog_promo ON card_catalog_records(is_promo);

      CREATE TABLE IF NOT EXISTS card_catalog_aliases (
        id INTEGER PRIMARY KEY,
        record_id INTEGER NOT NULL,
        alias TEXT NOT NULL,
        normalized_alias TEXT NOT NULL,
        locale TEXT,
        alias_kind TEXT NOT NULL,
        FOREIGN KEY(record_id) REFERENCES card_catalog_records(id) ON DELETE CASCADE,
        UNIQUE(record_id, normalized_alias, alias_kind, locale)
      );

      CREATE INDEX IF NOT EXISTS idx_card_catalog_alias_normalized ON card_catalog_aliases(normalized_alias);
      CREATE INDEX IF NOT EXISTS idx_card_catalog_alias_record ON card_catalog_aliases(record_id);

      CREATE TABLE IF NOT EXISTS card_catalog_identifiers (
        id INTEGER PRIMARY KEY,
        record_id INTEGER NOT NULL,
        identifier_value TEXT NOT NULL,
        normalized_value TEXT NOT NULL,
        identifier_kind TEXT NOT NULL,
        FOREIGN KEY(record_id) REFERENCES card_catalog_records(id) ON DELETE CASCADE,
        UNIQUE(record_id, normalized_value, identifier_kind)
      );

      CREATE INDEX IF NOT EXISTS idx_card_catalog_identifier_normalized ON card_catalog_identifiers(normalized_value);
      CREATE INDEX IF NOT EXISTS idx_card_catalog_identifier_record ON card_catalog_identifiers(record_id);

      CREATE TABLE IF NOT EXISTS card_catalog_references (
        id INTEGER PRIMARY KEY,
        record_id INTEGER NOT NULL,
        source_name TEXT NOT NULL,
        source_id TEXT,
        url TEXT,
        reference_kind TEXT,
        FOREIGN KEY(record_id) REFERENCES card_catalog_records(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_card_catalog_reference_record ON card_catalog_references(record_id);

      CREATE TABLE IF NOT EXISTS card_catalog_misses (
        normalized_query TEXT PRIMARY KEY,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        miss_count INTEGER NOT NULL
      );
    `);
    const columns = db.prepare('PRAGMA table_info(card_catalog_records)').all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === 'translated_set_name')) {
      db.exec('ALTER TABLE card_catalog_records ADD COLUMN translated_set_name TEXT;');
    }
    const existingColumns = new Set((db.prepare('PRAGMA table_info(card_catalog_records)').all() as Array<{ name: string }>).map((column) => column.name));
    const additiveColumns: Array<[string, string]> = [
      ['is_unnumbered', 'INTEGER NOT NULL DEFAULT 0'],
      ['release_type', 'TEXT'],
      ['release_event', 'TEXT'],
      ['release_year', 'INTEGER'],
      ['verification_status', 'TEXT']
    ];
    for (const [name, definition] of additiveColumns) {
      if (!existingColumns.has(name)) db.exec(`ALTER TABLE card_catalog_records ADD COLUMN ${name} ${definition};`);
    }
  } finally {
    db.close();
  }
}

export function replaceCardCatalogSourceRecords(
  source: string,
  records: CardCatalogRecord[],
  dbPath = cardCatalogPath()
): CardCatalogImportReport {
  initializeCardCatalogDb(dbPath);
  const db = openCardCatalogDb(dbPath);
  const insert = db.prepare(`
    INSERT INTO card_catalog_records (
      source, source_card_id, language, name, normalized_name, set_id, set_name,
      translated_set_name, normalized_set_name, series, card_number, normalized_card_number,
      printed_total, is_unnumbered, rarity, image_url, release_date, is_promo, promo_context,
      release_type, release_event, release_year, verification_status, source_updated_at, imported_at
    ) VALUES (
      @source, @sourceCardId, @language, @name, @normalizedName, @setId, @setName,
      @translatedSetName, @normalizedSetName, @series, @cardNumber, @normalizedCardNumber,
      @printedTotal, @isUnnumbered, @rarity, @imageUrl, @releaseDate, @isPromo, @promoContext,
      @releaseType, @releaseEvent, @releaseYear, @verificationStatus, @sourceUpdatedAt, @importedAt
    )
  `);
  const insertAlias = db.prepare(`
    INSERT OR IGNORE INTO card_catalog_aliases (
      record_id, alias, normalized_alias, locale, alias_kind
    ) VALUES (
      @recordId, @alias, @normalizedAlias, @locale, @kind
    )
  `);
  const insertIdentifier = db.prepare(`
    INSERT OR IGNORE INTO card_catalog_identifiers (
      record_id, identifier_value, normalized_value, identifier_kind
    ) VALUES (
      @recordId, @value, @normalizedValue, @kind
    )
  `);
  const insertReference = db.prepare(`
    INSERT INTO card_catalog_references (
      record_id, source_name, source_id, url, reference_kind
    ) VALUES (
      @recordId, @sourceName, @sourceId, @url, @kind
    )
  `);
  const report: CardCatalogImportReport = {
    examined: records.length,
    imported: 0,
    skipped: 0,
    missingImage: 0,
    byLanguage: {},
    bySource: {},
    errors: 0
  };
  const dbValue = (value: string | number | boolean | undefined | null): string | number | boolean | null => value ?? null;
  const replace = db.transaction(() => {
    db.prepare('DELETE FROM card_catalog_records WHERE source = ?').run(source);
    for (const record of records) {
      if (!record.sourceCardId || !record.name) {
        report.skipped += 1;
        continue;
      }
      try {
        insert.run({
          source: record.source,
          sourceCardId: record.sourceCardId,
          language: record.language,
          name: record.name,
          normalizedName: record.normalizedName,
          setId: dbValue(record.setId),
          setName: dbValue(record.setName),
          translatedSetName: dbValue(record.translatedSetName),
          normalizedSetName: dbValue(record.normalizedSetName),
          series: dbValue(record.series),
          cardNumber: dbValue(record.cardNumber),
          normalizedCardNumber: dbValue(record.normalizedCardNumber),
          printedTotal: dbValue(record.printedTotal),
          isUnnumbered: record.isUnnumbered ? 1 : 0,
          rarity: dbValue(record.rarity),
          imageUrl: dbValue(record.imageUrl),
          releaseDate: dbValue(record.releaseDate),
          isPromo: record.isPromo ? 1 : 0,
          promoContext: dbValue(record.promoContext),
          releaseType: dbValue(record.releaseType),
          releaseEvent: dbValue(record.releaseEvent),
          releaseYear: dbValue(record.releaseYear),
          verificationStatus: dbValue(record.verificationStatus),
          sourceUpdatedAt: dbValue(record.sourceUpdatedAt),
          importedAt: record.importedAt
        });
        const recordId = (db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id;
        for (const alias of record.aliases ?? []) {
          if (!alias.alias || !alias.normalizedAlias) continue;
          insertAlias.run({
            recordId,
            alias: alias.alias,
            normalizedAlias: alias.normalizedAlias,
            locale: alias.locale ?? '',
            kind: alias.kind
          });
        }
        for (const identifier of record.identifiers ?? []) {
          if (!identifier.value || !identifier.normalizedValue) continue;
          insertIdentifier.run({
            recordId,
            value: identifier.value,
            normalizedValue: identifier.normalizedValue,
            kind: identifier.kind
          });
        }
        for (const reference of record.references ?? []) {
          if (!reference.sourceName) continue;
          insertReference.run({
            recordId,
            sourceName: reference.sourceName,
            sourceId: reference.sourceId ?? null,
            url: reference.url ?? null,
            kind: reference.kind ?? null
          });
        }
        report.imported += 1;
        if (!record.imageUrl) report.missingImage += 1;
        report.byLanguage[record.language] = (report.byLanguage[record.language] ?? 0) + 1;
        report.bySource[record.source] = (report.bySource[record.source] ?? 0) + 1;
      } catch {
        report.errors += 1;
      }
    }
  });
  try {
    replace();
    return report;
  } finally {
    db.close();
  }
}

export function countCardCatalogSourceRecords(source: string, dbPath = cardCatalogPath()): number {
  if (!fs.existsSync(dbPath)) return 0;
  let db: Database.Database | undefined;
  try {
    db = openCardCatalogDb(dbPath, { readonly: true, fileMustExist: true });
    const row = db.prepare('SELECT COUNT(*) AS count FROM card_catalog_records WHERE source = ?').get(source) as { count: number };
    return row.count;
  } catch {
    return 0;
  } finally {
    db?.close();
  }
}

function rowToRecord(row: any): StoredCardCatalogRecord {
  return {
    id: row.id,
    source: row.source,
    sourceCardId: row.source_card_id,
    language: row.language,
    name: row.name,
    normalizedName: row.normalized_name,
    setId: row.set_id ?? undefined,
    setName: row.set_name ?? undefined,
    translatedSetName: row.translated_set_name ?? undefined,
    normalizedSetName: row.normalized_set_name ?? undefined,
    series: row.series ?? undefined,
    cardNumber: row.card_number ?? undefined,
    normalizedCardNumber: row.normalized_card_number ?? undefined,
    printedTotal: row.printed_total ?? undefined,
    isUnnumbered: row.is_unnumbered === 1,
    rarity: row.rarity ?? undefined,
    imageUrl: row.image_url ?? undefined,
    releaseDate: row.release_date ?? undefined,
    isPromo: row.is_promo === 1,
    promoContext: row.promo_context ?? undefined,
    releaseType: row.release_type ?? undefined,
    releaseEvent: row.release_event ?? undefined,
    releaseYear: row.release_year ?? undefined,
    verificationStatus: row.verification_status ?? undefined,
    sourceUpdatedAt: row.source_updated_at ?? undefined,
    importedAt: row.imported_at,
    aliases: [],
    identifiers: [],
    references: []
  };
}

export function getCardCatalogRecordBySourceCardId(source: string, sourceCardId: string, dbPath = cardCatalogPath()): StoredCardCatalogRecord | null {
  const resolved = dbPath;
  if (!fs.existsSync(resolved)) return null;
  let db: Database.Database | undefined;
  try {
    db = openCardCatalogDb(resolved, { readonly: true, fileMustExist: true });
    const row = db.prepare(`
      SELECT * FROM card_catalog_records
      WHERE source = ? AND source_card_id = ?
        AND (source != 'VAULTR_PROMO' OR verification_status = 'VERIFIED')
      LIMIT 1
    `).get(source, sourceCardId) as any | undefined;
    return row ? rowToRecord(row) : null;
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

export function queryCardCatalogRecords(params: {
  dbPath?: string;
  subject?: string;
  subjectAliases?: string[];
  normalizedQuery: string;
  normalizedCardNumber?: string;
  printedTotal?: string;
  releaseContext?: string;
  limit: number;
}): StoredCardCatalogRecord[] {
  const resolved = params.dbPath ?? cardCatalogPath();
  if (!fs.existsSync(resolved)) return [];
  let db: Database.Database | undefined;
  try {
    db = openCardCatalogDb(resolved, { readonly: true, fileMustExist: true });
    const subjectAliases = [...new Set([params.subject, ...(params.subjectAliases ?? [])].filter((value): value is string => !!value))].slice(0, 8);
    const subjectChecks = subjectAliases.map((_, index) => `
            normalized_name LIKE @subject${index}
            OR EXISTS (
              SELECT 1 FROM card_catalog_aliases a
              WHERE a.record_id = card_catalog_records.id
                AND a.normalized_alias LIKE @subject${index}
            )
    `);
    const subjectClause = subjectChecks.length > 0 ? subjectChecks.map((check) => `(${check})`).join(' OR ') : '1 = 1';
    const subjectParams = Object.fromEntries(subjectAliases.map((alias, index) => [`subject${index}`, `%${alias}%`]));
    const likeQuery = `%${params.normalizedQuery}%`;
    const hasNumber = params.normalizedCardNumber !== undefined;
    const rows = db.prepare(`
      SELECT * FROM card_catalog_records
      WHERE
        (source != 'VAULTR_PROMO' OR verification_status = 'VERIFIED')
        AND
        (
          (
            @hasNumber = 1
            AND normalized_card_number = @normalizedCardNumber
            AND (
              @printedTotal IS NULL
              OR printed_total = @printedTotal
              OR CAST(printed_total AS INTEGER) = CAST(@printedTotal AS INTEGER)
            )
            AND (
              ${subjectClause}
            )
          )
          OR (
            @hasNumber = 1
            AND @printedTotal IS NULL
            AND @releaseContext IS NOT NULL
            AND is_unnumbered = 1
            AND EXISTS (
              SELECT 1 FROM card_catalog_identifiers i
              WHERE i.record_id = card_catalog_records.id
                AND i.normalized_value = @normalizedCardNumber
            )
            AND (
              ${subjectClause}
            )
          )
          OR (
            @hasNumber = 0
            AND (
              normalized_name LIKE @likeQuery
              OR normalized_set_name LIKE @likeQuery
              OR EXISTS (
                SELECT 1 FROM card_catalog_aliases a
                WHERE a.record_id = card_catalog_records.id
                  AND a.normalized_alias LIKE @likeQuery
              )
              OR (${subjectClause})
            )
          )
        )
      ORDER BY is_promo DESC, release_date DESC, id ASC
      LIMIT @limit
    `).all({
      ...subjectParams,
      likeQuery,
      hasNumber: hasNumber ? 1 : 0,
      normalizedCardNumber: params.normalizedCardNumber,
      printedTotal: params.printedTotal,
      releaseContext: params.releaseContext ?? null,
      limit: Math.max(params.limit, 20)
    }) as any[];
    const records = rows.map(rowToRecord);
    if (records.length === 0) return records;
    const ids = records.map((record) => record.id);
    const placeholders = ids.map(() => '?').join(',');
    const aliasRows = db.prepare(`
      SELECT record_id, alias, normalized_alias, locale, alias_kind
      FROM card_catalog_aliases
      WHERE record_id IN (${placeholders})
      ORDER BY id ASC
    `).all(...ids) as Array<{ record_id: number; alias: string; normalized_alias: string; locale: string | null; alias_kind: string }>;
    const identifierRows = db.prepare(`
      SELECT record_id, identifier_value, normalized_value, identifier_kind
      FROM card_catalog_identifiers
      WHERE record_id IN (${placeholders})
      ORDER BY id ASC
    `).all(...ids) as Array<{ record_id: number; identifier_value: string; normalized_value: string; identifier_kind: string }>;
    const referenceRows = db.prepare(`
      SELECT record_id, source_name, source_id, url, reference_kind
      FROM card_catalog_references
      WHERE record_id IN (${placeholders})
      ORDER BY id ASC
    `).all(...ids) as Array<{ record_id: number; source_name: string; source_id: string | null; url: string | null; reference_kind: string | null }>;
    const aliasesByRecord = new Map<number, StoredCardCatalogRecord['aliases']>();
    for (const row of aliasRows) {
      const aliases = aliasesByRecord.get(row.record_id) ?? [];
      aliases.push({
        alias: row.alias,
        normalizedAlias: row.normalized_alias,
        locale: row.locale ?? undefined,
        kind: row.alias_kind as any
      });
      aliasesByRecord.set(row.record_id, aliases);
    }
    const identifiersByRecord = new Map<number, StoredCardCatalogRecord['identifiers']>();
    for (const row of identifierRows) {
      const identifiers = identifiersByRecord.get(row.record_id) ?? [];
      identifiers.push({
        value: row.identifier_value,
        normalizedValue: row.normalized_value,
        kind: row.identifier_kind as any
      });
      identifiersByRecord.set(row.record_id, identifiers);
    }
    const referencesByRecord = new Map<number, StoredCardCatalogRecord['references']>();
    for (const row of referenceRows) {
      const references = referencesByRecord.get(row.record_id) ?? [];
      references.push({
        sourceName: row.source_name,
        sourceId: row.source_id ?? undefined,
        url: row.url ?? undefined,
        kind: row.reference_kind ?? undefined
      });
      referencesByRecord.set(row.record_id, references);
    }
    return records.map((record) => ({
      ...record,
      aliases: aliasesByRecord.get(record.id) ?? [],
      identifiers: identifiersByRecord.get(record.id) ?? [],
      references: referencesByRecord.get(record.id) ?? []
    }));
  } catch (error) {
    console.warn(`local card catalog unavailable: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  } finally {
    db?.close();
  }
}

export function cardCatalogStats(dbPath = cardCatalogPath()): CardCatalogStats {
  initializeCardCatalogDb(dbPath);
  const db = openCardCatalogDb(dbPath, { readonly: true, fileMustExist: true });
  try {
    const totalRecords = (db.prepare('SELECT COUNT(*) AS count FROM card_catalog_records').get() as { count: number }).count;
    const sourceRows = db.prepare('SELECT source, COUNT(*) AS count FROM card_catalog_records GROUP BY source').all() as Array<{ source: string; count: number }>;
    const languageRows = db.prepare('SELECT language, COUNT(*) AS count FROM card_catalog_records GROUP BY language').all() as Array<{ language: string; count: number }>;
    const images = db.prepare("SELECT SUM(CASE WHEN image_url IS NOT NULL AND trim(image_url) != '' THEN 1 ELSE 0 END) AS withImage, SUM(CASE WHEN image_url IS NULL OR trim(image_url) = '' THEN 1 ELSE 0 END) AS withoutImage FROM card_catalog_records").get() as { withImage: number | null; withoutImage: number | null };
    const promoMarked = (db.prepare('SELECT COUNT(*) AS count FROM card_catalog_records WHERE is_promo = 1').get() as { count: number }).count;
    return {
      path: path.resolve(dbPath),
      sizeBytes: fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0,
      totalRecords,
      sourceCounts: Object.fromEntries(sourceRows.map((row) => [row.source, row.count])),
      languageCounts: Object.fromEntries(languageRows.map((row) => [row.language, row.count])),
      imageCoverage: { withImage: images.withImage ?? 0, withoutImage: images.withoutImage ?? 0 },
      promoMarked
    };
  } finally {
    db.close();
  }
}

export function normalizeCatalogMissQuery(query: string): string {
  return normalizeCatalogText(query).slice(0, 160);
}

export function recordCardCatalogMiss(query: string, dbPath = cardCatalogPath(), now = new Date().toISOString()): void {
  const normalizedQuery = normalizeCatalogMissQuery(query);
  if (!normalizedQuery) return;
  initializeCardCatalogDb(dbPath);
  const db = openCardCatalogDb(dbPath);
  try {
    db.prepare(`
      INSERT INTO card_catalog_misses (normalized_query, first_seen_at, last_seen_at, miss_count)
      VALUES (@normalizedQuery, @now, @now, 1)
      ON CONFLICT(normalized_query) DO UPDATE SET
        last_seen_at = excluded.last_seen_at,
        miss_count = miss_count + 1
    `).run({ normalizedQuery, now });
  } finally {
    db.close();
  }
}

export function listCardCatalogMisses(options: { dbPath?: string; limit?: number } = {}): Array<{ normalizedQuery: string; firstSeenAt: string; lastSeenAt: string; missCount: number }> {
  const resolved = options.dbPath ?? cardCatalogPath();
  if (!fs.existsSync(resolved)) return [];
  initializeCardCatalogDb(resolved);
  const db = openCardCatalogDb(resolved, { readonly: true, fileMustExist: true });
  try {
    const rows = db.prepare(`
      SELECT normalized_query, first_seen_at, last_seen_at, miss_count
      FROM card_catalog_misses
      ORDER BY miss_count DESC, last_seen_at DESC
      LIMIT @limit
    `).all({ limit: Math.max(1, Math.min(options.limit ?? 25, 100)) }) as Array<{ normalized_query: string; first_seen_at: string; last_seen_at: string; miss_count: number }>;
    return rows.map((row) => ({
      normalizedQuery: row.normalized_query,
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at,
      missCount: row.miss_count
    }));
  } finally {
    db.close();
  }
}
