import fs from 'node:fs';
import path, { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditPokumonJapanesePromoInventory, fetchPokumonJapanesePromoSnapshot, type PokumonJapanesePromoPrinting } from './services/card-catalog/pokumon-japanese-promo-inventory.js';
import { materializePokumonCoverageReport, pokumonMaterializerSummary, POKUMON_MATERIALIZED_PROMO_SETS, serializePokumonMaterializedSupplement } from './services/card-catalog/pokumon-japanese-promo-materializer.js';

const DEFAULT_OUTPUT = 'src/services/card-catalog/supplements/pokumon-japanese-promos.generated.ts';

function argValue(args: string[], name: string): string | undefined {
  const direct = args.find((arg) => arg.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function expectedMissing(args: string[], requireValue: boolean): number | undefined {
  const value = argValue(args, '--expected-missing');
  if (!value) {
    if (requireValue) throw new Error('--expected-missing is required with --write');
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`Invalid --expected-missing value: ${value}`);
  return parsed;
}

async function cacheOnlyPrintings(cacheDir: string): Promise<PokumonJapanesePromoPrinting[]> {
  const byUrl = new Map<string, PokumonJapanesePromoPrinting>();
  for (const set of POKUMON_MATERIALIZED_PROMO_SETS) {
    const printings = await fetchPokumonJapanesePromoSnapshot({
      cacheDir,
      sets: [set.toLowerCase()],
      seedUrls: [],
      allowNetwork: false,
      limitPages: 500
    });
    for (const printing of printings) byUrl.set(printing.url, printing);
  }
  return [...byUrl.values()];
}

export async function runCatalogMaterializePokumonCli(args = process.argv.slice(2)): Promise<void> {
  const write = args.includes('--write');
  const cacheDir = argValue(args, '--cache-dir') ?? './data/pokumon-cache';
  const output = argValue(args, '--output') ?? DEFAULT_OUTPUT;
  const expected = expectedMissing(args, write);
  const printings = await cacheOnlyPrintings(cacheDir);
  const report = auditPokumonJapanesePromoInventory(printings);
  const generated = materializePokumonCoverageReport(report, expected);
  if (write) {
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, serializePokumonMaterializedSupplement(generated));
  }
  console.log(JSON.stringify(pokumonMaterializerSummary(report, generated, output, write), null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCatalogMaterializePokumonCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
