import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importVerifiedCuratedRecords } from './services/card-catalog/importers/curated.js';

export function runCatalogImportCuratedCli(): void {
  console.log(JSON.stringify(importVerifiedCuratedRecords(), null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runCatalogImportCuratedCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
