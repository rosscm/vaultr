import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { backfillMissingChaseImages, type ChaseImageBackfillSummary } from './services/chase-image-backfill.js';

export type BackfillChaseImagesCliArgs = {
  apply: boolean;
  userId?: string;
};

export function parseBackfillChaseImagesArgs(argv: string[]): BackfillChaseImagesCliArgs {
  let apply = false;
  let userId: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--apply') {
      apply = true;
      continue;
    }
    if (token === '--user') {
      const value = argv[index + 1];
      if (!value) throw new Error('Missing value for --user');
      userId = value.trim();
      index += 1;
      continue;
    }
    if (token.startsWith('--user=')) {
      userId = token.slice('--user='.length).trim();
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }
  if (userId === '') throw new Error('Missing value for --user');
  return { apply, userId };
}

function printItem(item: ChaseImageBackfillSummary['items'][number]): void {
  const label = item.status === 'MATCH' ? 'MATCH'
    : item.status === 'UPDATED' ? 'UPDATE'
      : item.status === 'ERROR' ? 'ERROR'
        : 'SKIP';
  console.log(`${label.padEnd(6)} ${item.cardName} (${item.userId})`);
  if (item.status === 'MATCH' || item.status === 'UPDATED') {
    if (item.resolvedCardName && item.resolvedCardName !== item.cardName) {
      console.log(`  -> resolved as: ${item.resolvedCardName}`);
    } else {
      console.log(`  -> resolved: ${item.resolvedCardName ?? item.imageIdentity ?? item.cardName}`);
    }
    console.log(`  -> ${item.imageSourceName ?? 'unknown source'} / ${item.imageSourceCardId ?? 'unknown id'}`);
    console.log(`  -> ${item.imageUrl}`);
    return;
  }
  console.log(`  -> ${item.message}`);
}

export async function runBackfillChaseImagesCli(argv: string[]): Promise<ChaseImageBackfillSummary> {
  const args = parseBackfillChaseImagesArgs(argv);
  const summary = await backfillMissingChaseImages({ apply: args.apply, userId: args.userId });
  console.log(args.apply ? 'Chase image backfill apply' : 'Chase image backfill dry run');
  console.log(JSON.stringify({
    userId: summary.userId,
    examined: summary.examined,
    exactTrustedMatches: summary.exactTrustedMatches,
    wouldUpdate: summary.wouldUpdate,
    updated: summary.updated,
    skippedExistingImage: summary.skippedExistingImage,
    skippedNoMatch: summary.skippedNoMatch,
    skippedAmbiguous: summary.skippedAmbiguous,
    skippedFallbackOnly: summary.skippedFallbackOnly,
    skippedConflictingNumber: summary.skippedConflictingNumber,
    skippedConflictingRelease: summary.skippedConflictingRelease,
    skippedNoTrustedImage: summary.skippedNoTrustedImage,
    errors: summary.errors
  }, null, 2));
  for (const item of summary.items) printItem(item);
  return summary;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await runBackfillChaseImagesCli(process.argv.slice(2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  }
}
