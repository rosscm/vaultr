import { randomUUID } from 'node:crypto';
import { db } from './db.js';
import type { Chase } from '../types.js';

type ChaseRow = {
  id: string;
  user_id: string;
  card_name: string;
  max_price: number | null;
  grade: string | null;
  condition: string | null;
  region: 'CA' | 'US' | 'ANY';
  created_at: string;
};

function mapRow(row: ChaseRow): Chase {
  return {
    id: row.id,
    userId: row.user_id,
    cardName: row.card_name,
    maxPrice: row.max_price ?? undefined,
    grade: row.grade ?? undefined,
    condition: row.condition ?? undefined,
    region: row.region,
    createdAt: row.created_at
  };
}

const insertChaseStmt = db.prepare(`
  INSERT INTO chases (id, user_id, card_name, max_price, grade, condition, region, created_at)
  VALUES (@id, @user_id, @card_name, @max_price, @grade, @condition, @region, @created_at)
`);

const listChasesStmt = db.prepare(`
  SELECT id, user_id, card_name, max_price, grade, condition, region, created_at
  FROM chases
  WHERE user_id = ?
  ORDER BY created_at DESC
`);

const removeChaseStmt = db.prepare(`
  DELETE FROM chases
  WHERE user_id = ? AND id = ?
`);

export function addChase(input: Omit<Chase, 'id' | 'createdAt'>): Chase {
  const chase: Chase = {
    ...input,
    id: randomUUID(),
    createdAt: new Date().toISOString()
  };

  insertChaseStmt.run({
    id: chase.id,
    user_id: chase.userId,
    card_name: chase.cardName,
    max_price: chase.maxPrice ?? null,
    grade: chase.grade ?? null,
    condition: chase.condition ?? null,
    region: chase.region ?? 'ANY',
    created_at: chase.createdAt
  });

  return chase;
}

export function listChases(userId: string): Chase[] {
  const rows = listChasesStmt.all(userId) as ChaseRow[];
  return rows.map(mapRow);
}

export function removeChase(userId: string, chaseId: string): boolean {
  const result = removeChaseStmt.run(userId, chaseId);
  return result.changes > 0;
}
