import { getIdentityForUser } from './accounts.js';
import { db } from './db.js';

export type UserNotificationSettings = {
  discordCardAlertsEnabled: boolean;
  discordLinked: boolean;
  discordAlertInviteDismissed: boolean;
  updatedAt?: string;
};

const getStmt = db.prepare(`
  SELECT discord_card_alerts_enabled, discord_alert_invite_dismissed_at, updated_at
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
  const row = getStmt.get(userId) as { discord_card_alerts_enabled: number; discord_alert_invite_dismissed_at: string | null; updated_at: string } | undefined;
  return {
    discordCardAlertsEnabled: row?.discord_card_alerts_enabled === 1,
    discordLinked: !!getIdentityForUser(userId, 'DISCORD'),
    discordAlertInviteDismissed: Boolean(row?.discord_alert_invite_dismissed_at),
    updatedAt: row?.updated_at
  };
}

export function dismissDiscordAlertInvite(userId: string): UserNotificationSettings {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO user_notification_settings (user_id, discord_card_alerts_enabled, discord_alert_invite_dismissed_at, updated_at)
    VALUES (?, 0, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      discord_alert_invite_dismissed_at = excluded.discord_alert_invite_dismissed_at,
      updated_at = excluded.updated_at
  `).run(userId, now, now);
  return getUserNotificationSettings(userId);
}

export function setDiscordCardAlertsEnabled(userId: string, enabled: boolean): UserNotificationSettings {
  const linked = !!getIdentityForUser(userId, 'DISCORD');
  if (enabled && !linked) throw new Error('DISCORD_NOT_LINKED');
  upsertStmt.run(userId, enabled ? 1 : 0, new Date().toISOString());
  return getUserNotificationSettings(userId);
}
