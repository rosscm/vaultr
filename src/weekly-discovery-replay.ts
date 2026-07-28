import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { finalizeWeeklyDiscoveryShelf, type WeeklyDiscoveryFinalizerResult } from './commands/discover.js';
import {
  resolveWeeklyDiscoveryCanonicalReferences,
  type CanonicalLookupEvidenceMap,
  type CanonicalResolutionDiagnostics
} from './services/discovery-canonical-resolution.js';
import type { WeeklyDiscoveryFinalizationInput } from './services/weekly-discovery-ranking.js';

export type CaptureFixture = {
  schemaVersion: number;
  input: WeeklyDiscoveryFinalizationInput;
  canonicalLookupEvidence?: CanonicalLookupEvidenceMap;
};

type Options = {
  fixture: string;
  json: boolean;
  verbose: boolean;
  writeResult?: string;
  compare?: string;
  assertReleaseGate: boolean;
  assertReady: boolean;
};

export type WeeklyDiscoveryReplaySummary = {
  fingerprint: string;
  selectedCanonicalIds: Array<string | undefined>;
  itemCount: number;
  marketResolvedCount: number;
  marketIncompleteCount: number;
  roleDistribution: WeeklyDiscoveryFinalizerResult['roleDistribution'];
  structuralGate: WeeklyDiscoveryFinalizerResult['structuralGate'];
  qualityGate: WeeklyDiscoveryFinalizerResult['qualityGate'];
  averagePersonalRelevance: number;
  averageNovelty: number;
  subjectConcentration: number;
  familyConcentration: number;
  rejectionCounts: WeeklyDiscoveryFinalizerResult['selection']['rejectionCounts'];
  canonicalResolution: CanonicalResolutionDiagnostics;
  releaseGateFailures: string[];
};

export class WeeklyDiscoveryReplayOfflineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WeeklyDiscoveryReplayOfflineError';
  }
}

export type WeeklyDiscoveryReplayResult = {
  summary: WeeklyDiscoveryReplaySummary;
  result: WeeklyDiscoveryFinalizerResult;
};

function usage(): string {
  return [
    'Usage: npm run weekly:replay -- --fixture path.json [options]',
    '',
    'Options:',
    '  --json                  Print full result as JSON',
    '  --verbose               Include candidate outcome details',
    '  --write-result PATH     Persist replay result JSON',
    '  --compare PATH          Compare fingerprint with another replay result',
    '  --assert-release-gate   Exit non-zero if the complete release gate fails',
    '  --assert-ready          Alias for --assert-release-gate'
  ].join('\n');
}

function parseArgs(argv: string[]): Options {
  let fixture: string | undefined;
  let json = false;
  let verbose = false;
  let writeResult: string | undefined;
  let compare: string | undefined;
  let assertReleaseGate = false;
  let assertReady = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    }
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg === '--verbose') {
      verbose = true;
      continue;
    }
    if (arg === '--assert-release-gate') {
      assertReleaseGate = true;
      continue;
    }
    if (arg === '--assert-ready') {
      assertReady = true;
      continue;
    }
    if (arg === '--fixture') {
      fixture = argv[++index];
      continue;
    }
    if (arg.startsWith('--fixture=')) {
      fixture = arg.slice('--fixture='.length);
      continue;
    }
    if (arg === '--write-result') {
      writeResult = argv[++index];
      continue;
    }
    if (arg.startsWith('--write-result=')) {
      writeResult = arg.slice('--write-result='.length);
      continue;
    }
    if (arg === '--compare') {
      compare = argv[++index];
      continue;
    }
    if (arg.startsWith('--compare=')) {
      compare = arg.slice('--compare='.length);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  if (!fixture) throw new Error('Missing --fixture');
  return { fixture, json, verbose, writeResult, compare, assertReleaseGate, assertReady };
}

export function summarizeReplay(
  result: WeeklyDiscoveryFinalizerResult,
  canonicalResolution: CanonicalResolutionDiagnostics
): WeeklyDiscoveryReplaySummary {
  const releaseGateFailures: string[] = [];
  if (result.structuralGate.status !== 'PASS') {
    releaseGateFailures.push(`Structural gate failed: ${result.structuralGate.failures.join('; ')}`);
  }
  if (result.qualityGate.status !== 'PASS') {
    releaseGateFailures.push(`Quality gate failed: ${result.qualityGate.notes.join('; ')}`);
  }
  if (result.selection.items.length !== 20) {
    releaseGateFailures.push(`Expected 20 selected cards, found ${result.selection.items.length}.`);
  }
  if (result.selection.marketResolvedCount < 18) {
    releaseGateFailures.push(`Expected at least 18 market-resolved cards, found ${result.selection.marketResolvedCount}.`);
  }
  if (result.selection.marketIncompleteCount > 2) {
    releaseGateFailures.push(`Expected at most 2 market-incomplete cards, found ${result.selection.marketIncompleteCount}.`);
  }
  return {
    fingerprint: result.fingerprint,
    selectedCanonicalIds: result.selection.items.map((item) => item.suggestion.referenceSourceCardId),
    itemCount: result.selection.items.length,
    marketResolvedCount: result.selection.marketResolvedCount,
    marketIncompleteCount: result.selection.marketIncompleteCount,
    roleDistribution: result.roleDistribution,
    structuralGate: result.structuralGate,
    qualityGate: result.qualityGate,
    averagePersonalRelevance: result.averagePersonalRelevance,
    averageNovelty: result.averageNovelty,
    subjectConcentration: result.subjectConcentration,
    familyConcentration: result.familyConcentration,
    rejectionCounts: result.selection.rejectionCounts,
    canonicalResolution,
    releaseGateFailures
  };
}

function installOfflineReplayNetworkGuard(): () => void {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
    throw new WeeklyDiscoveryReplayOfflineError(`Weekly Discovery replay attempted network access: ${url}`);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

export async function replayWeeklyDiscoveryFixture(
  fixture: CaptureFixture
): Promise<WeeklyDiscoveryReplayResult> {
  const restoreFetch = installOfflineReplayNetworkGuard();
  try {
    const canonicalResolution = await resolveWeeklyDiscoveryCanonicalReferences(
      fixture.input.orderedCandidateReserve,
      { replayEvidence: fixture.canonicalLookupEvidence ?? {} }
    );
    const result = finalizeWeeklyDiscoveryShelf({
      ...fixture.input,
      orderedCandidateReserve: canonicalResolution.candidates
    });
    return {
      summary: summarizeReplay(result, canonicalResolution.diagnostics),
      result
    };
  } finally {
    restoreFetch();
  }
}

async function main(argv: string[]): Promise<void> {
  const options = parseArgs(argv);
  const fixture = JSON.parse(readFileSync(resolve(options.fixture), 'utf8')) as CaptureFixture;
  const replay = await replayWeeklyDiscoveryFixture(fixture);

  if (options.writeResult) {
    writeFileSync(resolve(options.writeResult), JSON.stringify({
      schemaVersion: fixture.schemaVersion,
      summary: replay.summary,
      candidateOutcomes: options.verbose ? replay.result.candidateOutcomes : undefined
    }, null, 2));
  }

  if (options.compare) {
    const other = JSON.parse(readFileSync(resolve(options.compare), 'utf8')) as { summary?: { fingerprint?: string } };
    if (other.summary?.fingerprint && other.summary.fingerprint !== replay.summary.fingerprint) {
      console.error(`Fingerprint mismatch: ${replay.summary.fingerprint} != ${other.summary.fingerprint}`);
      process.exit(1);
    }
  }

  if (options.json) {
    console.log(JSON.stringify({
      ...replay.summary,
      candidateOutcomes: options.verbose ? replay.result.candidateOutcomes : undefined
    }, null, 2));
  } else {
    console.log(`Fingerprint: ${replay.summary.fingerprint}`);
    console.log(`Selected: ${replay.summary.itemCount}`);
    console.log(`Market Resolved: ${replay.summary.marketResolvedCount}`);
    console.log(`Structural Gate: ${replay.summary.structuralGate.status}`);
    console.log(`Quality Gate: ${replay.summary.qualityGate.status}`);
    console.log(`Replay Evidence Hits/Misses: ${replay.summary.canonicalResolution.replayEvidenceHits}/${replay.summary.canonicalResolution.replayEvidenceMisses}`);
    console.log(`Provider Requests Attempted: ${replay.summary.canonicalResolution.providerRequestsAttempted}`);
    if (replay.summary.canonicalResolution.missingEvidence.length > 0) {
      console.log(`Missing Evidence Keys: ${replay.summary.canonicalResolution.missingEvidence.map((entry) => entry.lookupKey).join(', ')}`);
    }
    console.log(`Roles: core=${replay.summary.roleDistribution.CORE_MATCH} adjacent=${replay.summary.roleDistribution.ADJACENT_DISCOVERY} exploration=${replay.summary.roleDistribution.CONTROLLED_EXPLORATION}`);
  }

  if ((options.assertReleaseGate || options.assertReady) && replay.summary.releaseGateFailures.length > 0) {
    console.error(replay.summary.releaseGateFailures.join('\n'));
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2));
}
