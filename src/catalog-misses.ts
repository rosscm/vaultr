import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listCardCatalogMisses } from './services/card-catalog-db.js';

export function runCatalogMissesCli(argv: string[]): void {
  const limitArg = argv.find((arg) => /^\d+$/.test(arg) || arg.startsWith('--limit='));
  const limit = limitArg?.startsWith('--limit=') ? Number(limitArg.slice('--limit='.length)) : limitArg ? Number(limitArg) : undefined;
  console.log(JSON.stringify({ misses: listCardCatalogMisses({ limit }) }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runCatalogMissesCli(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
