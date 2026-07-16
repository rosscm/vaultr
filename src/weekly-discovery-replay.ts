import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { finalizeWeeklyDiscoveryShelf, type WeeklyDiscoveryFinalizerResult } from './commands/discover.js';
import type { WeeklyDiscoveryFinalizationInput } from './services/weekly-discovery-ranking.js';

type CaptureFixture = {
  schemaVersion: number;
  input: WeeklyDiscoveryFinalizationInput;
};

type Options = {
  fixture: string;
  json: boolean;
  verbose: boolean;
  writeResult?: string;
  compare?: string;
  assertReleaseGate: boolean;
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
    '  --assert-release-gate   Exit non-zero if the structural gate fails'
  ].join('\n');
}

function parseArgs(argv: string[]): Options {
  let fixture: string | undefined;
  let json = false;
  let verbose = false;
  let writeResult: string | undefined;
  let compare: string | undefined;
  let assertReleaseGate = false;
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
  return { fixture, json, verbose, writeResult, compare, assertReleaseGate };
}

function summarize(result: WeeklyDiscoveryFinalizerResult): Record<string, unknown> {
  return {
    fingerprint: result.fingerprint,
    selectedCanonicalIds: result.selection.items.map((item) => item.suggestion.referenceSourceCardId),
    roleDistribution: result.roleDistribution,
    structuralGate: result.structuralGate,
    qualityGate: result.qualityGate,
    averagePersonalRelevance: result.averagePersonalRelevance,
    averageNovelty: result.averageNovelty,
    subjectConcentration: result.subjectConcentration,
    familyConcentration: result.familyConcentration,
    rejectionCounts: result.selection.rejectionCounts
  };
}

const options = parseArgs(process.argv.slice(2));
const fixture = JSON.parse(readFileSync(resolve(options.fixture), 'utf8')) as CaptureFixture;
const result = finalizeWeeklyDiscoveryShelf(fixture.input);
const summary = summarize(result);

if (options.writeResult) {
  writeFileSync(resolve(options.writeResult), JSON.stringify({
    schemaVersion: fixture.schemaVersion,
    summary,
    candidateOutcomes: options.verbose ? result.candidateOutcomes : undefined
  }, null, 2));
}

if (options.compare) {
  const other = JSON.parse(readFileSync(resolve(options.compare), 'utf8')) as { summary?: { fingerprint?: string } };
  if (other.summary?.fingerprint && other.summary.fingerprint !== result.fingerprint) {
    console.error(`Fingerprint mismatch: ${result.fingerprint} != ${other.summary.fingerprint}`);
    process.exit(1);
  }
}

if (options.json) {
  console.log(JSON.stringify({
    ...summary,
    candidateOutcomes: options.verbose ? result.candidateOutcomes : undefined
  }, null, 2));
} else {
  console.log(`Fingerprint: ${result.fingerprint}`);
  console.log(`Selected: ${result.selection.items.length}`);
  console.log(`Structural Gate: ${result.structuralGate.status}`);
  console.log(`Quality Gate: ${result.qualityGate.status}`);
  console.log(`Roles: core=${result.roleDistribution.CORE_MATCH} adjacent=${result.roleDistribution.ADJACENT_DISCOVERY} exploration=${result.roleDistribution.CONTROLLED_EXPLORATION}`);
}

if (options.assertReleaseGate && result.structuralGate.status !== 'PASS') {
  console.error(`Structural gate failed: ${result.structuralGate.failures.join('; ')}`);
  process.exit(1);
}
