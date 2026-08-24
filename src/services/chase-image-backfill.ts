import {
  backfillChaseCardImage,
  listAllChases,
  listChases
} from './chase-store.js';
import {
  autocompleteChaseCards,
  getCachedChaseCardPreview,
  normalizeChaseCardName,
  type CachedChaseCardPreview,
  type ChaseCardAutocompleteChoice
} from './chase-card-catalog.js';
import type { Chase } from '../types.js';

export type ChaseImageBackfillStatus =
  | 'MATCH'
  | 'UPDATED'
  | 'SKIPPED_EXISTING_IMAGE'
  | 'SKIPPED_NO_MATCH'
  | 'SKIPPED_AMBIGUOUS'
  | 'SKIPPED_NO_TRUSTED_IMAGE'
  | 'ERROR';

export type ChaseImageBackfillItem = {
  userId: string;
  chaseId: string;
  cardName: string;
  status: ChaseImageBackfillStatus;
  message: string;
  imageUrl?: string;
  imageIdentity?: string;
  imageSourceName?: string;
  imageSourceKind?: CachedChaseCardPreview['imageSourceKind'];
  imageSourceCardId?: string;
};

export type ChaseImageBackfillSummary = {
  apply: boolean;
  userId?: string;
  examined: number;
  exactTrustedMatches: number;
  wouldUpdate: number;
  updated: number;
  skippedExistingImage: number;
  skippedNoMatch: number;
  skippedAmbiguous: number;
  skippedNoTrustedImage: number;
  errors: number;
  items: ChaseImageBackfillItem[];
};

type ChaseImageBackfillDependencies = {
  autocomplete?: (cardName: string, limit: number) => Promise<ChaseCardAutocompleteChoice[]>;
  preview?: (cardName: string) => CachedChaseCardPreview | undefined;
  update?: typeof backfillChaseCardImage;
};

export type ChaseImageBackfillOptions = {
  userId?: string;
  apply?: boolean;
  dependencies?: ChaseImageBackfillDependencies;
};

function chasesForBackfill(userId?: string): Chase[] {
  return userId ? listChases(userId) : listAllChases();
}

function isMissingImage(chase: Chase): boolean {
  return !chase.cardImageUrl || chase.cardImageUrl.trim().length === 0;
}

function normalizedIdentity(value: string): string {
  return normalizeChaseCardName(value).toLowerCase();
}

function trustedPreviewForBackfill(chase: Chase, preview: CachedChaseCardPreview | undefined): CachedChaseCardPreview | undefined {
  if (!preview?.imageUrl) return undefined;
  if (preview.imageSourceKind !== 'CARD_REFERENCE') return undefined;
  if (!preview.imageIdentity || normalizedIdentity(preview.imageIdentity) !== normalizedIdentity(chase.cardName)) return undefined;
  return preview;
}

async function inspectChaseImageBackfill(
  chase: Chase,
  dependencies: Required<ChaseImageBackfillDependencies>
): Promise<ChaseImageBackfillItem> {
  if (!isMissingImage(chase)) {
    return {
      userId: chase.userId,
      chaseId: chase.id,
      cardName: chase.cardName,
      status: 'SKIPPED_EXISTING_IMAGE',
      message: 'existing image present'
    };
  }

  const choices = await dependencies.autocomplete(chase.cardName, 25);
  const expected = normalizedIdentity(chase.cardName);
  const exactMatches = choices.filter((choice) => normalizedIdentity(choice.value) === expected);
  if (exactMatches.length === 0) {
    return {
      userId: chase.userId,
      chaseId: chase.id,
      cardName: chase.cardName,
      status: 'SKIPPED_NO_MATCH',
      message: 'no exact normalized autocomplete match'
    };
  }
  if (exactMatches.length > 1) {
    return {
      userId: chase.userId,
      chaseId: chase.id,
      cardName: chase.cardName,
      status: 'SKIPPED_AMBIGUOUS',
      message: 'multiple exact normalized autocomplete matches'
    };
  }

  const matchedValue = exactMatches[0]!.value;
  const preview = trustedPreviewForBackfill(chase, dependencies.preview(matchedValue) ?? dependencies.preview(chase.cardName));
  if (!preview?.imageUrl) {
    return {
      userId: chase.userId,
      chaseId: chase.id,
      cardName: chase.cardName,
      status: 'SKIPPED_NO_TRUSTED_IMAGE',
      message: 'exact match had no trusted CARD_REFERENCE preview'
    };
  }

  return {
    userId: chase.userId,
    chaseId: chase.id,
    cardName: chase.cardName,
    status: 'MATCH',
    message: 'exact trusted CARD_REFERENCE match',
    imageUrl: preview.imageUrl,
    imageIdentity: preview.imageIdentity,
    imageSourceName: preview.imageSourceName,
    imageSourceKind: preview.imageSourceKind,
    imageSourceCardId: preview.imageSourceCardId
  };
}

function emptySummary(apply: boolean, userId: string | undefined): ChaseImageBackfillSummary {
  return {
    apply,
    userId,
    examined: 0,
    exactTrustedMatches: 0,
    wouldUpdate: 0,
    updated: 0,
    skippedExistingImage: 0,
    skippedNoMatch: 0,
    skippedAmbiguous: 0,
    skippedNoTrustedImage: 0,
    errors: 0,
    items: []
  };
}

function countItem(summary: ChaseImageBackfillSummary, item: ChaseImageBackfillItem): void {
  if (item.status === 'MATCH' || item.status === 'UPDATED') summary.exactTrustedMatches += 1;
  if (item.status === 'MATCH') summary.wouldUpdate += 1;
  if (item.status === 'UPDATED') summary.updated += 1;
  if (item.status === 'SKIPPED_EXISTING_IMAGE') summary.skippedExistingImage += 1;
  if (item.status === 'SKIPPED_NO_MATCH') summary.skippedNoMatch += 1;
  if (item.status === 'SKIPPED_AMBIGUOUS') summary.skippedAmbiguous += 1;
  if (item.status === 'SKIPPED_NO_TRUSTED_IMAGE') summary.skippedNoTrustedImage += 1;
  if (item.status === 'ERROR') summary.errors += 1;
}

export async function backfillMissingChaseImages(options: ChaseImageBackfillOptions = {}): Promise<ChaseImageBackfillSummary> {
  const apply = options.apply === true;
  const dependencies: Required<ChaseImageBackfillDependencies> = {
    autocomplete: options.dependencies?.autocomplete ?? autocompleteChaseCards,
    preview: options.dependencies?.preview ?? getCachedChaseCardPreview,
    update: options.dependencies?.update ?? backfillChaseCardImage
  };
  const candidates = chasesForBackfill(options.userId).filter(isMissingImage);
  const summary = emptySummary(apply, options.userId);

  for (const chase of candidates) {
    summary.examined += 1;
    try {
      const inspected = await inspectChaseImageBackfill(chase, dependencies);
      const item = apply && inspected.status === 'MATCH'
        ? {
            ...inspected,
            status: dependencies.update({
              userId: chase.userId,
              chaseId: chase.id,
              imageUrl: inspected.imageUrl!,
              imageIdentity: inspected.imageIdentity!,
              imageSourceName: inspected.imageSourceName,
              imageSourceKind: inspected.imageSourceKind,
              imageSourceCardId: inspected.imageSourceCardId
            }) ? 'UPDATED' as const : 'SKIPPED_EXISTING_IMAGE' as const,
            message: 'image metadata backfilled'
          }
        : inspected;
      summary.items.push(item);
      countItem(summary, item);
    } catch (error) {
      const item: ChaseImageBackfillItem = {
        userId: chase.userId,
        chaseId: chase.id,
        cardName: chase.cardName,
        status: 'ERROR',
        message: error instanceof Error ? error.message : String(error)
      };
      summary.items.push(item);
      countItem(summary, item);
    }
  }

  return summary;
}
