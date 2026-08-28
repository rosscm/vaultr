import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCollectorInterestProfile } from './services/collector-profile.js';

export type CollectorProfileInspectArgs = {
  userId: string;
  json: boolean;
  evidence: boolean;
};

export function parseCollectorProfileInspectArgs(argv: string[]): CollectorProfileInspectArgs {
  let userId = '';
  let json = false;
  let evidence = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--user') userId = argv[++i] ?? '';
    else if (arg === '--json') json = true;
    else if (arg === '--evidence') evidence = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!userId.trim()) throw new Error('Usage: npm run profile:inspect -- --user <USER_ID> [--json] [--evidence]');
  return { userId: userId.trim(), json, evidence };
}

function printTraitSection(title: string, traits: Array<{ label: string; score: number; activeEvidenceCount: number; completedEvidenceCount: number }>): void {
  if (traits.length === 0) return;
  console.log(`\n${title}`);
  for (const trait of traits.slice(0, 8)) {
    console.log(`  ${trait.label.padEnd(28)} ${trait.score.toFixed(2)}  [${trait.activeEvidenceCount} active, ${trait.completedEvidenceCount} completed]`);
  }
}

export function runCollectorProfileInspectCli(argv: string[]): void {
  const args = parseCollectorProfileInspectArgs(argv);
  const profile = getCollectorInterestProfile(args.userId);
  if (args.json) {
    console.log(JSON.stringify(profile, null, 2));
    return;
  }
  console.log(`Collector Profile v${profile.version}`);
  console.log(`User: ${args.userId}`);
  console.log(`\nConfidence: ${profile.confidence.tier} (${profile.confidence.score.toFixed(2)})`);
  console.log(`Evidence: ${profile.sourceSummary.activeChases} active, ${profile.sourceSummary.completedChases} completed, ${profile.sourceSummary.distinctCards} distinct cards`);
  printTraitSection('Top subjects', profile.traits.subjects);
  printTraitSection('Languages', profile.traits.languages);
  printTraitSection('Sets', profile.traits.sets);
  printTraitSection('Formats', profile.traits.formats);
  printTraitSection('Promo interests', [...profile.traits.promoTypes, ...profile.traits.releaseEvents]);
  printTraitSection('Preferences', [...profile.traits.gradingPreferences, ...profile.traits.conditionPreferences]);
  if (args.evidence) {
    console.log('\nEvidence');
    for (const item of profile.evidence) console.log(`  ${item.source.padEnd(21)} ${item.sourceId}  ${item.cardName}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runCollectorProfileInspectCli(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
