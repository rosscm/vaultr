import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditPokumonJapanesePromoInventory, fetchPokumonJapanesePromoSnapshot, POKUMON_COMPLETE_JAPANESE_PROMO_SETS, POKUMON_INDIVIDUAL_SEED_URLS } from './services/card-catalog/pokumon-japanese-promo-inventory.js';

function argValue(args: string[], name: string): string | undefined {
  const direct = args.find((arg) => arg.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

export async function runCatalogAuditPokumonCli(args = process.argv.slice(2)): Promise<void> {
  const cacheDir = argValue(args, '--cache-dir') ?? './data/pokumon-cache';
  const sets = (argValue(args, '--sets') ?? POKUMON_COMPLETE_JAPANESE_PROMO_SETS.join(',')).split(',').map((set) => set.trim()).filter(Boolean);
  const seedUrls = [
    ...POKUMON_INDIVIDUAL_SEED_URLS,
    ...(argValue(args, '--seed') ? [argValue(args, '--seed')!] : [])
  ];
  const limitPages = Number(argValue(args, '--limit-pages') ?? '50');
  const printings = await fetchPokumonJapanesePromoSnapshot({
    cacheDir,
    sets,
    seedUrls,
    allowNetwork: args.includes('--network'),
    limitPages
  });
  console.log(JSON.stringify(auditPokumonJapanesePromoInventory(printings), null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCatalogAuditPokumonCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
