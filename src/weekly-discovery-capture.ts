import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { buildWeeklyDiscoveryFinalizationInput, finalizeWeeklyDiscoveryShelf } from './commands/discover.js';
import type { CanonicalLookupEvidenceMap } from './services/discovery-canonical-resolution.js';
import type { WeeklyDiscoveryFinalizationInput } from './services/weekly-discovery-ranking.js';

type Options = {
  date: Date;
  out: string;
  sanitizeOut?: string;
  userId: string;
};

function usage(): string {
  return [
    'Usage: npm run weekly:capture -- --date YYYY-MM-DD --user USER_ID --out path.json [--sanitize-out path.json]',
    '',
    'Capture enough normalized Weekly Discovery state to replay finalization offline.',
    'This command does not publish, send messages, or mutate scheduled drops.'
  ].join('\n');
}

function parseDate(value: string | undefined): Date {
  if (!value) throw new Error('Missing --date');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00.000Z`) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid --date value: ${value}`);
  return date;
}

function parseArgs(argv: string[]): Options {
  let dateValue: string | undefined;
  let out: string | undefined;
  let sanitizeOut: string | undefined;
  let userId: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    }
    if (arg === '--date') {
      dateValue = argv[++index];
      continue;
    }
    if (arg.startsWith('--date=')) {
      dateValue = arg.slice('--date='.length);
      continue;
    }
    if (arg === '--user') {
      userId = argv[++index];
      continue;
    }
    if (arg.startsWith('--user=')) {
      userId = arg.slice('--user='.length);
      continue;
    }
    if (arg === '--out') {
      out = argv[++index];
      continue;
    }
    if (arg.startsWith('--out=')) {
      out = arg.slice('--out='.length);
      continue;
    }
    if (arg === '--sanitize-out') {
      sanitizeOut = argv[++index];
      continue;
    }
    if (arg.startsWith('--sanitize-out=')) {
      sanitizeOut = arg.slice('--sanitize-out='.length);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  if (!userId || !out) throw new Error('Both --user and --out are required');
  return { date: parseDate(dateValue), out, sanitizeOut, userId };
}

function sanitizeCapture(input: WeeklyDiscoveryFinalizationInput): WeeklyDiscoveryFinalizationInput {
  return {
    ...input,
    activeVault: input.activeVault.map((chase, index) => ({
      ...chase,
      userId: 'user-synthetic-owner',
      id: `chase-${index + 1}`,
      note: undefined
    })),
    orderedCandidateReserve: input.orderedCandidateReserve.map((candidate, index) => ({
      ...candidate,
      selectionIndex: index,
      listing: candidate.listing
        ? {
            ...candidate.listing,
            url: candidate.listing.url.replace(/\?.*$/, ''),
            imageUrl: candidate.listing.imageUrl?.replace(/\?.*$/, ''),
            thumbnailUrl: candidate.listing.thumbnailUrl?.replace(/\?.*$/, '')
          }
        : undefined
    }))
  };
}

function ensureParentDir(path: string): void {
  mkdirSync(dirname(resolve(path)), { recursive: true });
}

const options = parseArgs(process.argv.slice(2));
const assembled = await buildWeeklyDiscoveryFinalizationInput({
  userId: options.userId,
  date: options.date,
  mode: 'CAPTURE',
  hydrateMarketInline: true,
  allowRecentRepeatFiller: false
});
const input: WeeklyDiscoveryFinalizationInput = assembled.input;
const canonicalLookupEvidence: CanonicalLookupEvidenceMap = assembled.canonicalLookupEvidence;
const preview = finalizeWeeklyDiscoveryShelf(input);
ensureParentDir(options.out);
writeFileSync(resolve(options.out), JSON.stringify({
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  userId: options.userId,
  input,
  canonicalLookupEvidence,
  preview: {
    fingerprint: preview.fingerprint,
    selectedCanonicalIds: preview.selection.items.map((item) => item.suggestion.referenceSourceCardId),
    roleDistribution: preview.roleDistribution,
    structuralGate: preview.structuralGate
  }
}, null, 2));

if (options.sanitizeOut) {
  ensureParentDir(options.sanitizeOut);
  writeFileSync(resolve(options.sanitizeOut), JSON.stringify({
    schemaVersion: 1,
    capturedAt: 'SANITIZED',
    userId: 'user-synthetic-owner',
    input: sanitizeCapture(input),
    canonicalLookupEvidence,
    preview: {
      fingerprint: preview.fingerprint,
      selectedCanonicalIds: preview.selection.items.map((item) => item.suggestion.referenceSourceCardId),
      roleDistribution: preview.roleDistribution,
      structuralGate: preview.structuralGate
    }
  }, null, 2));
}

console.log(`Captured Weekly Discovery input for ${options.userId} (${input.targetPeriod})`);
console.log(`Selected: ${preview.selection.items.length} | fingerprint=${preview.fingerprint.slice(0, 12)}`);
