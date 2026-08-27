import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cardCatalogPath, initializeCardCatalogDb } from './services/card-catalog-db.js';

export function runCatalogInitCli(): void {
  initializeCardCatalogDb();
  console.log(JSON.stringify({ ok: true, path: cardCatalogPath() }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runCatalogInitCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
