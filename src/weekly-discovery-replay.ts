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
import type {
  DiscoveryValueComponents,
  PersonalRelevanceComponents,
  WeeklyDiscoveryFinalizationInput,
  WeeklyDiscoveryRole
} from './services/weekly-discovery-ranking.js';
import { WEEKLY_DISCOVERY_MARKET_POLICY } from './services/weekly-discovery-policy.js';

export type CaptureFixture = {
  schemaVersion: number;
  candidateRepresentation?: 'PREPARED_FINALIZATION_INPUT';
  input: WeeklyDiscoveryFinalizationInput;
  canonicalLookupEvidence?: CanonicalLookupEvidenceMap;
  preview?: {
    fingerprint: string;
    selectedCanonicalIds: Array<string | undefined>;
    roleDistribution: WeeklyDiscoveryFinalizerResult['roleDistribution'];
    structuralGate: WeeklyDiscoveryFinalizerResult['structuralGate'];
  };
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
  qualityInspection: WeeklyDiscoveryQualityInspection;
  releaseGateFailures: string[];
};

type WeeklyDiscoveryQualityCandidate = {
  rank: number;
  name: string;
  canonicalCardId?: string;
  role?: WeeklyDiscoveryRole;
  outcome?: string;
  rejectionDetail?: string;
  lane: string;
  marketStatus: 'READY' | 'INCOMPLETE';
  baseScore?: number;
  slateScore?: number;
  personalRelevance?: PersonalRelevanceComponents;
  discoveryValue?: DiscoveryValueComponents;
  broadPromoContribution?: number;
  distinctiveSignals: {
    artists: string[];
    eras: string[];
    releaseTypes: string[];
    artTiers: string[];
    promoTypes: string[];
  };
  strongestSignals: string[];
};

type WeeklyDiscoveryQualityInspection = {
  preSelectionRoleDistribution: Record<WeeklyDiscoveryRole, number>;
  selectedRoleDistribution: Record<WeeklyDiscoveryRole, number>;
  selectedBroadPromoAffinityCount: number;
  selectedDistinctiveTraitCount: number;
  selectedCandidates: WeeklyDiscoveryQualityCandidate[];
  highestRankedExcluded: WeeklyDiscoveryQualityCandidate[];
  recoverySelections: WeeklyDiscoveryFinalizerResult['selection']['capRelaxationSelections'];
  qualitySwapSelections: WeeklyDiscoveryFinalizerResult['selection']['qualitySwapSelections'];
};

function qualityInspection(result: WeeklyDiscoveryFinalizerResult): WeeklyDiscoveryQualityInspection {
  const preSelectionRoleDistribution: Record<WeeklyDiscoveryRole, number> = {
    CORE_MATCH: 0,
    ADJACENT_DISCOVERY: 0,
    CONTROLLED_EXPLORATION: 0
  };
  for (const candidate of result.rerankedReserve) {
    if (candidate.weeklyDiscovery) preSelectionRoleDistribution[candidate.weeklyDiscovery.discoveryRole] += 1;
  }
  const selectedIds = new Set(result.selection.items.map((item) => item.suggestion.referenceSourceCardId));
  const selectedAnalyses = result.rerankedReserve
    .filter((candidate) => selectedIds.has(candidate.suggestion.referenceSourceCardId))
    .map((candidate) => candidate.weeklyDiscovery)
    .filter((analysis): analysis is NonNullable<typeof analysis> => !!analysis);
  const candidateDiagnostic = (candidate: WeeklyDiscoveryFinalizerResult['rerankedReserve'][number], index: number): WeeklyDiscoveryQualityCandidate => {
    const outcome = result.candidateOutcomes[index];
    const analysis = candidate.weeklyDiscovery;
    const relevance = analysis?.rankExplanation.scoreComponents.personalRelevance;
    const market = analysis?.rankExplanation.scoreComponents.marketSuitability;
    return {
      rank: index + 1,
      name: candidate.suggestion.name,
      canonicalCardId: candidate.suggestion.referenceSourceCardId,
      role: analysis?.discoveryRole,
      outcome: outcome.outcome,
      rejectionDetail: outcome.detail,
      lane: candidate.suggestion.lane,
      marketStatus: market?.marketResolved ? 'READY' as const : 'INCOMPLETE' as const,
      baseScore: analysis?.rankExplanation.scoreComponents.baseScore,
      slateScore: analysis?.rankExplanation.scoreComponents.slateScore,
      personalRelevance: relevance,
      discoveryValue: analysis?.rankExplanation.scoreComponents.discoveryValue,
      broadPromoContribution: relevance?.promoAffinity,
      distinctiveSignals: {
        artists: analysis?.features.artists ?? [],
        eras: analysis?.features.eras ?? [],
        releaseTypes: analysis?.features.releaseTypes ?? [],
        artTiers: analysis?.features.artTiers ?? [],
        promoTypes: analysis?.features.promoTypes ?? []
      },
      strongestSignals: analysis?.rankExplanation.strongestSignals ?? []
    };
  };
  const selectedCandidates = result.rerankedReserve.flatMap((candidate, index) =>
    selectedIds.has(candidate.suggestion.referenceSourceCardId) ? [candidateDiagnostic(candidate, index)] : []
  );
  const highestRankedExcluded = result.rerankedReserve.flatMap((candidate, index) =>
    selectedIds.has(candidate.suggestion.referenceSourceCardId) ? [] : [candidateDiagnostic(candidate, index)]
  ).slice(0, 12);
  return {
    preSelectionRoleDistribution,
    selectedRoleDistribution: result.roleDistribution,
    selectedBroadPromoAffinityCount: selectedAnalyses.filter((analysis) =>
      analysis.rankExplanation.scoreComponents.personalRelevance.promoAffinity > 0
    ).length,
    selectedDistinctiveTraitCount: selectedAnalyses.filter((analysis) =>
      analysis.features.artists.length > 0
      || analysis.features.eras.length > 0
      || analysis.features.releaseTypes.length > 0
      || analysis.features.artTiers.length > 0
    ).length,
    selectedCandidates,
    highestRankedExcluded,
    recoverySelections: result.selection.capRelaxationSelections,
    qualitySwapSelections: result.selection.qualitySwapSelections
  };
}

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
  if (result.qualityGate.status === 'FAIL') {
    releaseGateFailures.push(`Quality gate failed: ${result.qualityGate.notes.join('; ')}`);
  }
  if (result.selection.items.length !== WEEKLY_DISCOVERY_MARKET_POLICY.shelfSize) {
    releaseGateFailures.push(`Expected ${WEEKLY_DISCOVERY_MARKET_POLICY.shelfSize} selected cards, found ${result.selection.items.length}.`);
  }
  if (result.selection.marketResolvedCount < WEEKLY_DISCOVERY_MARKET_POLICY.minMarketResolved) {
    releaseGateFailures.push(`Expected at least ${WEEKLY_DISCOVERY_MARKET_POLICY.minMarketResolved} market-resolved cards, found ${result.selection.marketResolvedCount}.`);
  }
  if (result.selection.marketIncompleteCount > WEEKLY_DISCOVERY_MARKET_POLICY.maxMarketIncomplete) {
    releaseGateFailures.push(`Expected at most ${WEEKLY_DISCOVERY_MARKET_POLICY.maxMarketIncomplete} market-incomplete cards, found ${result.selection.marketIncompleteCount}.`);
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
    qualityInspection: qualityInspection(result),
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
    // Capture-generated schema-v1 fixtures already stored the production-prepared
    // reserve, although they did not label that representation explicitly.
    const hasPreparedCandidateRepresentation = fixture.candidateRepresentation === 'PREPARED_FINALIZATION_INPUT'
      || !!fixture.preview;
    const canonicalResolution = await resolveWeeklyDiscoveryCanonicalReferences(
      fixture.input.orderedCandidateReserve,
      {
        replayEvidence: fixture.canonicalLookupEvidence ?? {},
        preservePreparedCandidates: hasPreparedCandidateRepresentation
      }
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
    const other = JSON.parse(readFileSync(resolve(options.compare), 'utf8')) as {
      summary?: Pick<WeeklyDiscoveryReplaySummary, 'fingerprint' | 'selectedCanonicalIds' | 'roleDistribution' | 'marketResolvedCount'>;
    };
    if (other.summary?.selectedCanonicalIds) {
      const previousIds = new Set(other.summary.selectedCanonicalIds);
      const currentIds = new Set(replay.summary.selectedCanonicalIds);
      console.log(`Added: ${replay.summary.selectedCanonicalIds.filter((id) => !previousIds.has(id)).filter(Boolean).join(', ') || 'none'}`);
      console.log(`Removed: ${other.summary.selectedCanonicalIds.filter((id) => !currentIds.has(id)).filter(Boolean).join(', ') || 'none'}`);
      console.log(`Market resolved: ${other.summary.marketResolvedCount} -> ${replay.summary.marketResolvedCount}`);
      console.log(`Roles: ${JSON.stringify(other.summary.roleDistribution)} -> ${JSON.stringify(replay.summary.roleDistribution)}`);
    }
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
    if (options.verbose) {
      const pool = replay.summary.qualityInspection.preSelectionRoleDistribution;
      console.log(`Pre-selection roles: core=${pool.CORE_MATCH} adjacent=${pool.ADJACENT_DISCOVERY} exploration=${pool.CONTROLLED_EXPLORATION}`);
      for (const candidate of replay.summary.qualityInspection.highestRankedExcluded) {
        console.log([
          `Excluded #${candidate.rank}: ${candidate.name}`,
          candidate.role ?? 'unclassified',
          candidate.marketStatus,
          candidate.outcome ?? 'unknown',
          candidate.rejectionDetail ?? 'no detail',
          `base=${candidate.baseScore ?? 'n/a'}`,
          `slate=${candidate.slateScore ?? 'n/a'}`,
          `promo=${candidate.broadPromoContribution ?? 0}`
        ].join(' | '));
      }
      for (const recovery of replay.summary.qualityInspection.recoverySelections) {
        console.log(`Recovery: ${recovery.suggestionName} | ${recovery.recoveryKind ?? 'BOUNDED'} | ${recovery.relaxedReason}:${recovery.relaxedKey ?? ''}`);
      }
      for (const swap of replay.summary.qualityInspection.qualitySwapSelections) {
        console.log(`Quality swap: ${swap.replacedSuggestionName} -> ${swap.selectedSuggestionName} | subject=${swap.matchedSubject} | ready=${swap.marketResolvedBefore}->${swap.marketResolvedAfter}`);
      }
    }
  }

  if ((options.assertReleaseGate || options.assertReady) && replay.summary.releaseGateFailures.length > 0) {
    console.error(replay.summary.releaseGateFailures.join('\n'));
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2));
}
