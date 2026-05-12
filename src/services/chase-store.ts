import { randomUUID } from 'node:crypto';
import type { Chase } from '../types.js';

const chases = new Map<string, Chase[]>();

export function addChase(input: Omit<Chase, 'id' | 'createdAt'>): Chase {
  const chase: Chase = {
    ...input,
    id: randomUUID(),
    createdAt: new Date().toISOString()
  };

  const existing = chases.get(input.userId) ?? [];
  chases.set(input.userId, [...existing, chase]);
  return chase;
}

export function listChases(userId: string): Chase[] {
  return chases.get(userId) ?? [];
}

export function removeChase(userId: string, chaseId: string): boolean {
  const existing = chases.get(userId) ?? [];
  const filtered = existing.filter((c) => c.id !== chaseId);
  chases.set(userId, filtered);
  return filtered.length < existing.length;
}
