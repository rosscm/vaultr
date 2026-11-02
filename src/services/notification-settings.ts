import { getIdentityForUser } from './accounts.js';
import { db } from './db.js';

export type UserNotificationSettings = {
  discordCardAlertsEnabled: boolean;
  discordLinked: boolean;
  updatedAt?: string;
};

const getStmt = db.prepare(`
  SELECT discord_card_alerts_enabled, updated_at
  FROM user_notification_settings
  WHERE user_id = ?
`);

const upsertStmt = db.prepare(`
  INSERT INTO user_notification_settings (user_id, discord_card_alerts_enabled, updated_at)
  VALUES (?, ?, ?)
  ON CONFLICT(user_id) DO UPDATE SET
    discord_card_alerts_enabled = excluded.discord_card_alerts_enabled,
    updated_at = excluded.updated_at
`);

export function getUserNotificationSettings(userId: string): UserNotificationSettings {
  const row = getStmt.get(userId) as { discord_card_alerts_enabled: number; updated_at: string } | undefined;
  return {
    discordCardAlertsEnabled: row?.discord_card_alerts_enabled === 1,
    discordLinked: !!getIdentityForUser(userId, 'DISCORD'),
    updatedAt: row?.updated_at
  };
}

export function setDiscordCardAlertsEnabled(userId: string, enabled: boolean): UserNotificationSettings {
  const linked = !!getIdentityForUser(userId, 'DISCORD');
  if (enabled && !linked) throw new Error('DISCORD_NOT_LINKED');
  upsertStmt.run(userId, enabled ? 1 : 0, new Date().toISOString());
  return getUserNotificationSettings(userId);
}
