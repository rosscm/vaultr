import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importVaultrPromoSupplementRecords } from './services/card-catalog/importers/vaultr-promos.js';

export function runCatalogImportPromosCli(): void {
  console.log(JSON.stringify(importVaultrPromoSupplementRecords(), null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runCatalogImportPromosCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
