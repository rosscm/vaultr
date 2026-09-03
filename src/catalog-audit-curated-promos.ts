import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditCuratedJapanesePromos } from './services/card-catalog/curated-japanese-promo-audit.js';

export function runCatalogAuditCuratedPromosCli(args = process.argv.slice(2)): void {
  const includeCovered = args.includes('--include-covered');
  console.log(JSON.stringify(auditCuratedJapanesePromos({ includeCovered }), null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runCatalogAuditCuratedPromosCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
