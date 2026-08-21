import { createHash, randomBytes } from 'node:crypto';
import { db } from './db.js';

const SESSION_TOKEN_BYTES = 32;
const DEFAULT_SESSION_TTL_DAYS = 30;

export type WebSessionProfile = {
  userId: string;
  discordUsername?: string;
  discordGlobalName?: string;
  discordAvatar?: string;
};

export type WebSession = WebSessionProfile & {
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt?: string;
};

type WebSessionRow = {
  token_hash: string;
  user_id: string;
  discord_username: string | null;
  discord_global_name: string | null;
  discord_avatar: string | null;
  created_at: string;
  expires_at: string;
  last_seen_at: string | null;
};

const insertSessionStmt = db.prepare(`
  INSERT INTO web_sessions (
    token_hash, user_id, discord_username, discord_global_name, discord_avatar,
    created_at, expires_at, last_seen_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const getSessionStmt = db.prepare(`
  SELECT token_hash, user_id, discord_username, discord_global_name, discord_avatar,
    created_at, expires_at, last_seen_at
  FROM web_sessions
  WHERE token_hash = ?
  LIMIT 1
`);

const updateSessionLastSeenStmt = db.prepare(`
  UPDATE web_sessions
  SET last_seen_at = ?
  WHERE token_hash = ?
`);

const deleteSessionStmt = db.prepare(`
  DELETE FROM web_sessions
  WHERE token_hash = ?
`);

export function hashWebSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function generateWebSessionToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
}

function mapWebSession(row: WebSessionRow): WebSession {
  return {
    tokenHash: row.token_hash,
    userId: row.user_id,
    discordUsername: row.discord_username ?? undefined,
    discordGlobalName: row.discord_global_name ?? undefined,
    discordAvatar: row.discord_avatar ?? undefined,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastSeenAt: row.last_seen_at ?? undefined
  };
}

export function createWebSession(
  profile: WebSessionProfile,
  options: { now?: Date; ttlDays?: number; token?: string } = {}
): { token: string; session: WebSession } {
  const now = options.now ?? new Date();
  const ttlDays = options.ttlDays ?? DEFAULT_SESSION_TTL_DAYS;
  const expiresAt = new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000);
  const token = options.token ?? generateWebSessionToken();
  const tokenHash = hashWebSessionToken(token);
  const createdAtIso = now.toISOString();
  const expiresAtIso = expiresAt.toISOString();

  insertSessionStmt.run(
    tokenHash,
    profile.userId,
    profile.discordUsername ?? null,
    profile.discordGlobalName ?? null,
    profile.discordAvatar ?? null,
    createdAtIso,
    expiresAtIso,
    createdAtIso
  );

  return {
    token,
    session: {
      tokenHash,
      userId: profile.userId,
      discordUsername: profile.discordUsername,
      discordGlobalName: profile.discordGlobalName,
      discordAvatar: profile.discordAvatar,
      createdAt: createdAtIso,
      expiresAt: expiresAtIso,
      lastSeenAt: createdAtIso
    }
  };
}

export function resolveWebSession(token: string | undefined, now: Date = new Date()): WebSession | null {
  if (!token) return null;
  const tokenHash = hashWebSessionToken(token);
  const row = getSessionStmt.get(tokenHash) as WebSessionRow | undefined;
  if (!row) return null;
  if (Date.parse(row.expires_at) <= now.getTime()) {
    deleteSessionStmt.run(tokenHash);
    return null;
  }
  const seenAt = now.toISOString();
  updateSessionLastSeenStmt.run(seenAt, tokenHash);
  return mapWebSession({ ...row, last_seen_at: seenAt });
}

export function revokeWebSession(token: string | undefined): void {
  if (!token) return;
  deleteSessionStmt.run(hashWebSessionToken(token));
}

export function getWebSessionByTokenHash(tokenHash: string): WebSession | null {
  const row = getSessionStmt.get(tokenHash) as WebSessionRow | undefined;
  return row ? mapWebSession(row) : null;
}
