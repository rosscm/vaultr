import 'dotenv/config';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function parseEbayVerificationOnceArgs(argv: string[]): { listingId: string } {
  let listingId = '';
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--listing-id') {
      listingId = argv[index + 1]?.trim() ?? '';
      index += 1;
    } else if (token.startsWith('--listing-id=')) {
      listingId = token.slice('--listing-id='.length).trim();
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  if (!listingId) throw new Error('An explicit --listing-id is required');
  return { listingId };
}

export async function runEbayVerificationOnceCli(argv: string[]): Promise<void> {
  const { listingId } = parseEbayVerificationOnceArgs(argv);
  const service = await import('./services/ebay-listing-verification.js');
  if (service.ebayHistoricalVerificationEnabled()) {
    throw new Error('One-shot verification requires the recurring historical worker to remain disabled');
  }
  const result = await service.processExplicitEbayListingVerification({ listingId });
  console.log(JSON.stringify(result, null, 2));
  if (result.attempted !== 1) process.exitCode = 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runEbayVerificationOnceCli(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
