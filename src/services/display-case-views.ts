import { db } from './db.js';

const getStmt = db.prepare(`SELECT period_key, viewed_at FROM user_display_case_views WHERE user_id = ?`);
const upsertStmt = db.prepare(`
  INSERT INTO user_display_case_views (user_id, period_key, viewed_at)
  VALUES (?, ?, ?)
  ON CONFLICT(user_id) DO UPDATE SET period_key = excluded.period_key, viewed_at = excluded.viewed_at
`);

export function hasViewedDisplayCasePeriod(userId: string, periodKey: string): boolean {
  const row = getStmt.get(userId) as { period_key: string } | undefined;
  return row?.period_key === periodKey;
}

export function markDisplayCasePeriodViewed(userId: string, periodKey: string, now = new Date().toISOString()): void {
  upsertStmt.run(userId, periodKey, now);
}
