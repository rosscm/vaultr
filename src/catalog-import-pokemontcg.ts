import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { replaceCardCatalogSourceRecords } from './services/card-catalog-db.js';
import { loadPokemonTcgRepositoryRecords } from './services/card-catalog/importers/pokemontcg.js';

export function runCatalogImportPokemonTcgCli(argv: string[]): void {
  const sourceDir = argv[0];
  if (!sourceDir) throw new Error('Usage: npm run catalog:import:pokemontcg -- /path/to/pokemon-tcg-data');
  const loaded = loadPokemonTcgRepositoryRecords(sourceDir);
  if (loaded.records.length === 0) throw new Error(`No importable PokemonTCG records found in ${sourceDir}`);
  const report = replaceCardCatalogSourceRecords('POKEMONTCG', loaded.records);
  console.log(JSON.stringify({ ...report, examined: loaded.examined, skipped: loaded.examined - report.imported, errors: loaded.errors + report.errors }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runCatalogImportPokemonTcgCli(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
