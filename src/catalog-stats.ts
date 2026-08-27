import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cardCatalogStats } from './services/card-catalog-db.js';

export function runCatalogStatsCli(): void {
  console.log(JSON.stringify(cardCatalogStats(), null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runCatalogStatsCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
