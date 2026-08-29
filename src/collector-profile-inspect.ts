import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getIdentity } from './services/accounts.js';
import { getCollectorInterestProfile } from './services/collector-profile.js';
import { collectorInterestProfileToTasteProfile } from './services/collector-profile-ranking-adapter.js';

export type CollectorProfileInspectArgs = {
  userId: string;
  discordUserId?: string;
  json: boolean;
  evidence: boolean;
  ranker: boolean;
};

export function parseCollectorProfileInspectArgs(argv: string[]): CollectorProfileInspectArgs {
  let userId = '';
  let discordUserId = '';
  let json = false;
  let evidence = false;
  let ranker = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--user') userId = argv[++i] ?? '';
    else if (arg === '--discord-user') discordUserId = argv[++i] ?? '';
    else if (arg === '--json') json = true;
    else if (arg === '--evidence') evidence = true;
    else if (arg === '--ranker') ranker = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  userId = userId.trim();
  discordUserId = discordUserId.trim();
  if (userId && discordUserId) throw new Error('Use either --user or --discord-user, not both.');
  if (userId && !userId.startsWith('usr_')) throw new Error('--user expects a Vaultr account ID beginning with usr_. Use --discord-user for a Discord ID.');
  if (json && ranker) throw new Error('--ranker is human-readable inspection only. Use it without --json.');
  if (!userId && !discordUserId) throw new Error('Usage: npm run profile:inspect -- --user usr_<ID> [--json] [--evidence] [--ranker]\n       npm run profile:inspect -- --discord-user <DISCORD_ID> [--json] [--evidence] [--ranker]');
  return { userId, discordUserId: discordUserId || undefined, json, evidence, ranker };
}

function sourceCountLabel(trait: { activeEvidenceCount: number; completedEvidenceCount: number; legacyEvidenceCount: number }): string {
  return [
    trait.activeEvidenceCount > 0 ? `${trait.activeEvidenceCount} active` : undefined,
    trait.completedEvidenceCount > 0 ? `${trait.completedEvidenceCount} completed` : undefined,
    trait.legacyEvidenceCount > 0 ? `${trait.legacyEvidenceCount} legacy` : undefined
  ].filter(Boolean).join(', ');
}

function printTraitSection(title: string, traits: Array<{ label: string; score: number; activeEvidenceCount: number; completedEvidenceCount: number; legacyEvidenceCount: number }>): void {
  if (traits.length === 0) return;
  console.log(`\n${title}`);
  for (const trait of traits.slice(0, 8)) {
    console.log(`  ${trait.label.padEnd(28)} ${trait.score.toFixed(2)}  [${sourceCountLabel(trait)}]`);
  }
}

function printRankerSection(title: string, values: Record<string, number>): void {
  const entries = Object.entries(values).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (entries.length === 0) return;
  console.log(`\n${title}`);
  for (const [key, weight] of entries.slice(0, 8)) console.log(`  ${key.padEnd(28)} ${weight.toFixed(2)}`);
}

export function runCollectorProfileInspectCli(argv: string[]): void {
  const args = parseCollectorProfileInspectArgs(argv);
  const userId = args.discordUserId ? getIdentity('DISCORD', args.discordUserId)?.userId : args.userId;
  if (!userId) throw new Error(`No Vaultr account is linked to Discord user ${args.discordUserId}.`);
  const profile = getCollectorInterestProfile(userId);
  if (args.json) {
    console.log(JSON.stringify(profile, null, 2));
    return;
  }
  console.log(`Collector Profile v${profile.version}`);
  console.log(`User: ${userId}`);
  console.log(`\nConfidence: ${profile.confidence.tier} (${profile.confidence.score.toFixed(2)})`);
  const legacyText = profile.sourceSummary.legacyBoughtOrSeen > 0 ? `, ${profile.sourceSummary.legacyBoughtOrSeen} legacy` : '';
  console.log(`Evidence: ${profile.sourceSummary.activeChases} active, ${profile.sourceSummary.completedChases} completed${legacyText}, ${profile.sourceSummary.distinctCards} distinct cards`);
  if (args.ranker) {
    const rankerProfile = collectorInterestProfileToTasteProfile(profile);
    console.log('\nRanker adapter');
    printRankerSection('Subjects', rankerProfile.subjects);
    printRankerSection('Languages', rankerProfile.languages);
    printRankerSection('Sets', rankerProfile.sets);
    printRankerSection('Eras', rankerProfile.eras);
    printRankerSection('Formats', rankerProfile.formats);
    printRankerSection('Rarity tiers', rankerProfile.rarityTiers);
    printRankerSection('Promo types', rankerProfile.promoTypes);
    printRankerSection('Release types', rankerProfile.releaseTypes);
    return;
  }
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
