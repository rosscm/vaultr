import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { countCardCatalogSourceRecords, replaceCardCatalogSourceRecords } from './services/card-catalog-db.js';
import { loadTcgDexRepositoryRecords } from './services/card-catalog/importers/tcgdex.js';

export function runCatalogImportTcgDexCli(argv: string[]): void {
  const force = argv.includes('--force');
  const allowTinyFixture = argv.includes('--allow-tiny-fixture');
  const sourceDir = argv.find((arg) => !arg.startsWith('--'));
  if (!sourceDir) throw new Error('Usage: npm run catalog:import:tcgdex -- /path/to/cards-database');
  const loaded = loadTcgDexRepositoryRecords(sourceDir);
  if (loaded.records.length === 0) throw new Error(`No importable TCGdex records found in ${sourceDir}`);
  if (!allowTinyFixture && !force && loaded.records.length < 1000) throw new Error(`TCGdex import found only ${loaded.records.length} records; pass --allow-tiny-fixture for tests or --force for intentional small imports`);
  const existing = countCardCatalogSourceRecords('TCGDEX');
  if (!force && existing > 0 && loaded.records.length < existing * 0.5) throw new Error(`TCGdex import found ${loaded.records.length} records, less than 50% of existing ${existing}; pass --force to replace`);
  const report = replaceCardCatalogSourceRecords('TCGDEX', loaded.records);
  console.log(JSON.stringify({ ...report, examined: loaded.examined, skipped: loaded.examined - report.imported, errors: loaded.errors + report.errors }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runCatalogImportTcgDexCli(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
