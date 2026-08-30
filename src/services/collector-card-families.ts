function normalizeFamilySubject(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export const COLLECTOR_CARD_FAMILIES = {
  PIKACHU_LINE: ['Pichu', 'Pikachu', 'Raichu'],
  SQUIRTLE_LINE: ['Squirtle', 'Wartortle', 'Blastoise'],
  EEVEE_FAMILY: ['Eevee', 'Vaporeon', 'Jolteon', 'Flareon', 'Espeon', 'Umbreon', 'Leafeon', 'Glaceon', 'Sylveon'],
  GARDEVOIR_LINE: ['Ralts', 'Kirlia', 'Gardevoir', 'Gallade']
} as const;

const SUBJECT_TO_FAMILY = new Map<string, string>(
  Object.entries(COLLECTOR_CARD_FAMILIES).flatMap(([familyKey, members]) =>
    members.map((member) => [normalizeFamilySubject(member), familyKey] as const)
  )
);

export function collectorFamilyKeyForSubject(subject: string | undefined): string | undefined {
  const normalized = normalizeFamilySubject(subject ?? '');
  if (!normalized) return undefined;
  return SUBJECT_TO_FAMILY.get(normalized);
}

export function collectorFamilyKeysForSubjects(subjects: string[]): string[] {
  const keys: string[] = [];
  for (const subject of subjects) {
    const familyKey = collectorFamilyKeyForSubject(subject);
    if (familyKey && !keys.includes(familyKey)) keys.push(familyKey);
  }
  return keys;
}
