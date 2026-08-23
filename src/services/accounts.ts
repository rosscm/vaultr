import { randomUUID } from 'node:crypto';
import { db } from './db.js';

export type VaultrUserId = string;
export type DiscordUserId = string;
export type IdentityProvider = 'DISCORD';

export type VaultrUser = {
  id: VaultrUserId;
  displayName?: string;
  avatarUrl?: string;
  createdAt: string;
  updatedAt: string;
};

export type UserIdentity = {
  id: string;
  userId: VaultrUserId;
  provider: IdentityProvider;
  providerUserId: string;
  username?: string;
  displayName?: string;
  avatarUrl?: string;
  email?: string;
  createdAt: string;
  updatedAt: string;
};

export type DiscordIdentityInput = {
  discordUserId: DiscordUserId;
  username?: string;
  displayName?: string;
  avatarUrl?: string;
};

type UserRow = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
};

type IdentityRow = {
  id: string;
  user_id: string;
  provider: string;
  provider_user_id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  email: string | null;
  created_at: string;
  updated_at: string;
};

const VAULTR_USER_ID_PREFIX = 'usr_';
const IDENTITY_ID_PREFIX = 'ident_';

function generateVaultrUserId(): VaultrUserId {
  return `${VAULTR_USER_ID_PREFIX}${randomUUID()}`;
}

function generateIdentityId(): string {
  return `${IDENTITY_ID_PREFIX}${randomUUID()}`;
}

function mapUser(row: UserRow): VaultrUser {
  return {
    id: row.id,
    displayName: row.display_name ?? undefined,
    avatarUrl: row.avatar_url ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapIdentity(row: IdentityRow): UserIdentity {
  return {
    id: row.id,
    userId: row.user_id,
    provider: row.provider as IdentityProvider,
    providerUserId: row.provider_user_id,
    username: row.username ?? undefined,
    displayName: row.display_name ?? undefined,
    avatarUrl: row.avatar_url ?? undefined,
    email: row.email ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

const insertUserStmt = db.prepare(`
  INSERT INTO users (id, display_name, avatar_url, created_at, updated_at)
  VALUES (@id, @display_name, @avatar_url, @created_at, @updated_at)
`);

const getUserByIdStmt = db.prepare(`
  SELECT id, display_name, avatar_url, created_at, updated_at
  FROM users
  WHERE id = ?
  LIMIT 1
`);

const updateUserProfileStmt = db.prepare(`
  UPDATE users
  SET display_name = COALESCE(@display_name, display_name),
      avatar_url = COALESCE(@avatar_url, avatar_url),
      updated_at = @updated_at
  WHERE id = @id
`);

const insertIdentityStmt = db.prepare(`
  INSERT INTO user_identities (
    id, user_id, provider, provider_user_id, username, display_name, avatar_url, email, created_at, updated_at
  )
  VALUES (
    @id, @user_id, @provider, @provider_user_id, @username, @display_name, @avatar_url, @email, @created_at, @updated_at
  )
`);

const getIdentityStmt = db.prepare(`
  SELECT id, user_id, provider, provider_user_id, username, display_name, avatar_url, email, created_at, updated_at
  FROM user_identities
  WHERE provider = ? AND provider_user_id = ?
  LIMIT 1
`);

const getIdentityForUserStmt = db.prepare(`
  SELECT id, user_id, provider, provider_user_id, username, display_name, avatar_url, email, created_at, updated_at
  FROM user_identities
  WHERE user_id = ? AND provider = ?
  LIMIT 1
`);

const listIdentitiesForUserStmt = db.prepare(`
  SELECT id, user_id, provider, provider_user_id, username, display_name, avatar_url, email, created_at, updated_at
  FROM user_identities
  WHERE user_id = ?
  ORDER BY provider ASC
`);

const updateIdentityProfileStmt = db.prepare(`
  UPDATE user_identities
  SET username = COALESCE(@username, username),
      display_name = COALESCE(@display_name, display_name),
      avatar_url = COALESCE(@avatar_url, avatar_url),
      email = COALESCE(@email, email),
      updated_at = @updated_at
  WHERE provider = @provider AND provider_user_id = @provider_user_id
`);

export function createUser(input: { displayName?: string; avatarUrl?: string } = {}): VaultrUser {
  const now = new Date().toISOString();
  const id = generateVaultrUserId();
  insertUserStmt.run({
    id,
    display_name: input.displayName ?? null,
    avatar_url: input.avatarUrl ?? null,
    created_at: now,
    updated_at: now
  });
  const user = getUserById(id);
  if (!user) throw new Error('Failed to create Vaultr user');
  return user;
}

export function getUserById(userId: VaultrUserId): VaultrUser | null {
  const row = getUserByIdStmt.get(userId) as UserRow | undefined;
  return row ? mapUser(row) : null;
}

export function getIdentity(provider: IdentityProvider, providerUserId: string): UserIdentity | null {
  const row = getIdentityStmt.get(provider, providerUserId) as IdentityRow | undefined;
  return row ? mapIdentity(row) : null;
}

export function getIdentitiesForUser(userId: VaultrUserId): UserIdentity[] {
  return (listIdentitiesForUserStmt.all(userId) as IdentityRow[]).map(mapIdentity);
}

export function getIdentityForUser(userId: VaultrUserId, provider: IdentityProvider): UserIdentity | null {
  const row = getIdentityForUserStmt.get(userId, provider) as IdentityRow | undefined;
  return row ? mapIdentity(row) : null;
}

export function linkIdentity(input: {
  userId: VaultrUserId;
  provider: IdentityProvider;
  providerUserId: string;
  username?: string;
  displayName?: string;
  avatarUrl?: string;
  email?: string;
}): UserIdentity {
  const now = new Date().toISOString();
  insertIdentityStmt.run({
    id: generateIdentityId(),
    user_id: input.userId,
    provider: input.provider,
    provider_user_id: input.providerUserId,
    username: input.username ?? null,
    display_name: input.displayName ?? null,
    avatar_url: input.avatarUrl ?? null,
    email: input.email ?? null,
    created_at: now,
    updated_at: now
  });
  const identity = getIdentity(input.provider, input.providerUserId);
  if (!identity) throw new Error('Failed to link identity');
  return identity;
}

export function updateIdentityProfile(input: {
  provider: IdentityProvider;
  providerUserId: string;
  username?: string;
  displayName?: string;
  avatarUrl?: string;
  email?: string;
}): UserIdentity | null {
  updateIdentityProfileStmt.run({
    provider: input.provider,
    provider_user_id: input.providerUserId,
    username: input.username ?? null,
    display_name: input.displayName ?? null,
    avatar_url: input.avatarUrl ?? null,
    email: input.email ?? null,
    updated_at: new Date().toISOString()
  });
  return getIdentity(input.provider, input.providerUserId);
}

export function resolveOrCreateDiscordUser(input: DiscordIdentityInput): VaultrUser {
  const existing = getIdentity('DISCORD', input.discordUserId);
  const displayName = input.displayName ?? input.username;
  if (existing) {
    updateIdentityProfile({
      provider: 'DISCORD',
      providerUserId: input.discordUserId,
      username: input.username,
      displayName,
      avatarUrl: input.avatarUrl
    });
    updateUserProfileStmt.run({
      id: existing.userId,
      display_name: displayName ?? null,
      avatar_url: input.avatarUrl ?? null,
      updated_at: new Date().toISOString()
    });
    const user = getUserById(existing.userId);
    if (!user) throw new Error('Discord identity points at missing Vaultr user');
    return user;
  }

  return db.transaction(() => {
    const user = createUser({ displayName, avatarUrl: input.avatarUrl });
    linkIdentity({
      userId: user.id,
      provider: 'DISCORD',
      providerUserId: input.discordUserId,
      username: input.username,
      displayName,
      avatarUrl: input.avatarUrl
    });
    return user;
  })();
}

export function resolveDiscordUserId(vaultrUserId: VaultrUserId): DiscordUserId | null {
  return getIdentityForUser(vaultrUserId, 'DISCORD')?.providerUserId ?? null;
}

export function discordAvatarUrl(discordUserId: DiscordUserId, avatarHash: string | undefined): string | undefined {
  if (!avatarHash) return undefined;
  return `https://cdn.discordapp.com/avatars/${encodeURIComponent(discordUserId)}/${encodeURIComponent(avatarHash)}.png?size=80`;
}
