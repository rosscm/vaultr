import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { searchLocalCardCatalog } from './services/card-catalog/search.js';

export function runCatalogSearchCli(argv: string[]): void {
  const query = argv.join(' ').trim();
  if (!query) throw new Error('Usage: npm run catalog:search -- "mew rc24"');
  console.log(JSON.stringify({ query, items: searchLocalCardCatalog(query, 25) }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runCatalogSearchCli(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
