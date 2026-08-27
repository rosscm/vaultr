import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
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
        rarity TEXT,
        image_url TEXT,
        release_date TEXT,
        is_promo INTEGER NOT NULL DEFAULT 0,
        promo_context TEXT,
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
    `);
    const columns = db.prepare('PRAGMA table_info(card_catalog_records)').all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === 'translated_set_name')) {
      db.exec('ALTER TABLE card_catalog_records ADD COLUMN translated_set_name TEXT;');
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
      printed_total, rarity, image_url, release_date, is_promo, promo_context,
      source_updated_at, imported_at
    ) VALUES (
      @source, @sourceCardId, @language, @name, @normalizedName, @setId, @setName,
      @translatedSetName, @normalizedSetName, @series, @cardNumber, @normalizedCardNumber,
      @printedTotal, @rarity, @imageUrl, @releaseDate, @isPromo, @promoContext,
      @sourceUpdatedAt, @importedAt
    )
  `);
  const insertAlias = db.prepare(`
    INSERT OR IGNORE INTO card_catalog_aliases (
      record_id, alias, normalized_alias, locale, alias_kind
    ) VALUES (
      @recordId, @alias, @normalizedAlias, @locale, @kind
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
          rarity: dbValue(record.rarity),
          imageUrl: dbValue(record.imageUrl),
          releaseDate: dbValue(record.releaseDate),
          isPromo: record.isPromo ? 1 : 0,
          promoContext: dbValue(record.promoContext),
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
    rarity: row.rarity ?? undefined,
    imageUrl: row.image_url ?? undefined,
    releaseDate: row.release_date ?? undefined,
    isPromo: row.is_promo === 1,
    promoContext: row.promo_context ?? undefined,
    sourceUpdatedAt: row.source_updated_at ?? undefined,
    importedAt: row.imported_at,
    aliases: []
  };
}

export function queryCardCatalogRecords(params: {
  dbPath?: string;
  subject?: string;
  subjectAliases?: string[];
  normalizedQuery: string;
  normalizedCardNumber?: string;
  printedTotal?: string;
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
      ORDER BY is_promo DESC, release_date DESC, id ASC
      LIMIT @limit
    `).all({
      ...subjectParams,
      likeQuery,
      hasNumber: hasNumber ? 1 : 0,
      normalizedCardNumber: params.normalizedCardNumber,
      printedTotal: params.printedTotal,
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
    return records.map((record) => ({ ...record, aliases: aliasesByRecord.get(record.id) ?? [] }));
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
