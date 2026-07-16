import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { finalizeWeeklyDiscoveryShelf } from './commands/discover.js';
import type { WeeklyDiscoveryFinalizationInput } from './services/weekly-discovery-ranking.js';

type HumanDiscoveryJudgment = {
  canonicalCardId: string;
  relevance: 0 | 1 | 2 | 3;
  novelty?: 0 | 1 | 2;
  notes?: string;
};

type CaptureFixture = {
  schemaVersion: number;
  input: WeeklyDiscoveryFinalizationInput;
};

function dcg(scores: number[]): number {
  return scores.reduce((sum, score, index) => sum + ((2 ** score - 1) / Math.log2(index + 2)), 0);
}

function ndcg(scores: number[]): number {
  const actual = dcg(scores);
  const ideal = dcg([...scores].sort((a, b) => b - a));
  return ideal === 0 ? 0 : actual / ideal;
}

const args = process.argv.slice(2);
const fixtureIndex = args.indexOf('--fixture');
const judgmentsIndex = args.indexOf('--judgments');
if (fixtureIndex < 0 || !args[fixtureIndex + 1] || judgmentsIndex < 0 || !args[judgmentsIndex + 1]) {
  console.log('Usage: npm run weekly:evaluate -- --fixture path.json --judgments path.json');
  process.exit(1);
}

const fixture = JSON.parse(readFileSync(resolve(args[fixtureIndex + 1]!), 'utf8')) as CaptureFixture;
const judgments = JSON.parse(readFileSync(resolve(args[judgmentsIndex + 1]!), 'utf8')) as HumanDiscoveryJudgment[];
const result = finalizeWeeklyDiscoveryShelf(fixture.input);
const selectedIds = result.selection.items.map((item) => item.suggestion.referenceSourceCardId).filter((value): value is string => !!value);
const relevanceScores = selectedIds.map((id) => judgments.find((entry) => entry.canonicalCardId === id)?.relevance ?? 0);
const noveltyScores = selectedIds.map((id) => judgments.find((entry) => entry.canonicalCardId === id)?.novelty ?? 0);
const ratedThree = relevanceScores.filter((score) => score === 3).length;
const ratedTwoPlus = relevanceScores.filter((score) => score >= 2).length;
const ratedZero = relevanceScores.filter((score) => score === 0).length;

console.log(`Fingerprint: ${result.fingerprint}`);
console.log(`Selected canonical IDs: ${selectedIds.join(', ')}`);
console.log(`Rated 3: ${ratedThree}`);
console.log(`Rated 2+: ${ratedTwoPlus}`);
console.log(`Rated 0: ${ratedZero}`);
console.log(`Average relevance: ${(relevanceScores.reduce<number>((sum, score) => sum + score, 0) / Math.max(1, relevanceScores.length)).toFixed(3)}`);
console.log(`NDCG@20: ${ndcg(relevanceScores).toFixed(4)}`);
console.log(`Subject concentration: ${result.subjectConcentration}`);
console.log(`Family concentration: ${result.familyConcentration}`);
console.log(`Role distribution: core=${result.roleDistribution.CORE_MATCH} adjacent=${result.roleDistribution.ADJACENT_DISCOVERY} exploration=${result.roleDistribution.CONTROLLED_EXPLORATION}`);
console.log(`Mean novelty: ${(noveltyScores.reduce<number>((sum, score) => sum + score, 0) / Math.max(1, noveltyScores.length)).toFixed(3)}`);
console.log(`Catalogue-image integrity: ${result.structuralGate.failures.some((failure) => failure.includes('CARD_REFERENCE')) ? 'FAIL' : 'PASS'}`);
console.log(`Market coverage: ${result.selection.marketResolvedCount}/${result.selection.items.length}`);
console.log(`STRUCTURAL_GATE: ${result.structuralGate.status}`);
console.log(`QUALITY_GATE: ${ratedTwoPlus >= 12 && ratedThree >= 4 && ratedZero <= 3 ? 'PASS' : 'FAIL'}`);
