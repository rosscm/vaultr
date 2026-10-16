import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID
} from 'node:crypto';
import { db } from './db.js';
import { createUser, getIdentity, getIdentityForUser, linkIdentity } from './accounts.js';

export type MagicLinkPurpose = 'SIGN_IN' | 'LINK_EMAIL';

export type MagicLinkEmail = {
  to: string;
  signInUrl: string;
  expiresAt: string;
  purpose: MagicLinkPurpose;
};

export type MagicLinkEmailTransport = {
  sendMagicLink(message: MagicLinkEmail): Promise<{ messageId?: string }>;
};

export type EmailAuthConfig = {
  baseUrl: string;
  encryptionKey: Buffer;
  transport: MagicLinkEmailTransport;
};

const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;
const CONFIRMATION_TTL_MS = 10 * 60 * 1000;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const EMAIL_RATE_LIMIT = 5;
const IP_RATE_LIMIT = 20;
const MAX_DELIVERY_ATTEMPTS = 3;

type MagicLinkRow = {
  id: string;
  token_hash: string;
  email: string;
  purpose: MagicLinkPurpose;
  user_id: string | null;
  return_path: string;
  expires_at: string;
  consumed_at: string | null;
};

type ConfirmationRow = {
  nonce_hash: string;
  magic_link_id: string;
  expires_at: string;
  consumed_at: string | null;
};

type OutboxRow = {
  id: string;
  magic_link_id: string;
  encrypted_payload: string | null;
  payload_iv: string | null;
  payload_tag: string | null;
  attempts: number;
  expires_at: string;
};

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function normalizeEmailAddress(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (!email || email.length > 254 || /[\u0000-\u001f\u007f]/.test(email)) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

export function safeAuthReturnPath(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return '/app';
  const raw = value.trim();
  if (raw.includes('\\') || raw.startsWith('//')) return '/app';
  try {
    const parsed = new URL(raw, 'https://vaultr.invalid');
    if (parsed.origin !== 'https://vaultr.invalid') return '/app';
    if (parsed.pathname !== '/app' && parsed.pathname !== '/app/') return '/app';
    if (parsed.username || parsed.password) return '/app';
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return '/app';
  }
}

export function parseEmailAuthEncryptionKey(value: string | undefined): Buffer | null {
  if (!value) return null;
  try {
    const key = Buffer.from(value, 'base64');
    return key.length === 32 ? key : null;
  } catch {
    return null;
  }
}

function encryptPayload(payload: object, key: Buffer): { ciphertext: string; iv: string; tag: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64')
  };
}

function decryptPayload(row: OutboxRow, key: Buffer): { token: string } {
  if (!row.encrypted_payload || !row.payload_iv || !row.payload_tag) throw new Error('missing_encrypted_payload');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(row.payload_iv, 'base64'));
  decipher.setAuthTag(Buffer.from(row.payload_tag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(row.encrypted_payload, 'base64')),
    decipher.final()
  ]).toString('utf8');
  const parsed = JSON.parse(plaintext) as { token?: unknown };
  if (typeof parsed.token !== 'string' || !parsed.token) throw new Error('invalid_encrypted_payload');
  return { token: parsed.token };
}

function requestRateKey(kind: 'email' | 'ip', value: string, key: Buffer): string {
  return sha256(`${kind}:${key.toString('base64')}:${value}`);
}

function countRecentRequests(column: 'email_rate_key' | 'ip_rate_key', key: string, now: Date): number {
  const cutoff = new Date(now.getTime() - RATE_WINDOW_MS).toISOString();
  const row = db.prepare(`SELECT COUNT(*) AS count FROM auth_magic_links WHERE ${column} = ? AND created_at >= ?`).get(key, cutoff) as { count: number };
  return Number(row.count);
}

export function requestMagicLink(input: {
  email: string;
  purpose: MagicLinkPurpose;
  userId?: string;
  returnPath?: string;
  ipAddress?: string;
  config: EmailAuthConfig;
  now?: Date;
}): { accepted: true; queued: boolean } {
  const email = normalizeEmailAddress(input.email);
  if (!email) throw new Error('invalid_email');
  if (input.purpose === 'LINK_EMAIL' && !input.userId) throw new Error('link_requires_user');
  const now = input.now ?? new Date();
  const emailRateKey = requestRateKey('email', email, input.config.encryptionKey);
  const ipRateKey = requestRateKey('ip', input.ipAddress?.trim() || 'unknown', input.config.encryptionKey);
  if (
    countRecentRequests('email_rate_key', emailRateKey, now) >= EMAIL_RATE_LIMIT ||
    countRecentRequests('ip_rate_key', ipRateKey, now) >= IP_RATE_LIMIT
  ) {
    return { accepted: true, queued: false };
  }

  const token = randomBytes(32).toString('base64url');
  const tokenHash = sha256(token);
  const id = `magic_${randomUUID()}`;
  const outboxId = `email_${randomUUID()}`;
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + MAGIC_LINK_TTL_MS).toISOString();
  const encrypted = encryptPayload({ token }, input.config.encryptionKey);
  db.transaction(() => {
    const priorLinks = db.prepare(`
      SELECT id FROM auth_magic_links
      WHERE email = ? AND purpose = ? AND COALESCE(user_id, '') = COALESCE(?, '') AND consumed_at IS NULL
    `).all(email, input.purpose, input.userId ?? null) as Array<{ id: string }>;
    for (const prior of priorLinks) {
      db.prepare('UPDATE auth_magic_links SET consumed_at = ? WHERE id = ?').run(createdAt, prior.id);
      db.prepare(`
        UPDATE auth_email_outbox
        SET status = 'SUPERSEDED', encrypted_payload = NULL, payload_iv = NULL, payload_tag = NULL,
            last_error = 'superseded', updated_at = ?
        WHERE magic_link_id = ? AND status IN ('PENDING', 'SENDING')
      `).run(createdAt, prior.id);
    }
    db.prepare(`
      INSERT INTO auth_magic_links (
        id, token_hash, email, purpose, user_id, return_path, email_rate_key, ip_rate_key,
        created_at, expires_at, consumed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    `).run(
      id,
      tokenHash,
      email,
      input.purpose,
      input.userId ?? null,
      safeAuthReturnPath(input.returnPath),
      emailRateKey,
      ipRateKey,
      createdAt,
      expiresAt
    );
    db.prepare(`
      INSERT INTO auth_email_outbox (
        id, magic_link_id, encrypted_payload, payload_iv, payload_tag, status, attempts,
        next_attempt_at, provider_message_id, last_error, created_at, updated_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, 'PENDING', 0, ?, NULL, NULL, ?, ?, ?)
    `).run(outboxId, id, encrypted.ciphertext, encrypted.iv, encrypted.tag, createdAt, createdAt, createdAt, expiresAt);
  })();
  return { accepted: true, queued: true };
}

export async function processPendingMagicLinkEmails(
  config: EmailAuthConfig,
  options: { now?: Date; limit?: number } = {}
): Promise<{ sent: number; failed: number; expired: number }> {
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const limit = Math.max(1, Math.min(25, Math.floor(options.limit ?? 10)));
  const expiredResult = db.prepare(`
    UPDATE auth_email_outbox
    SET status = 'EXPIRED', encrypted_payload = NULL, payload_iv = NULL, payload_tag = NULL,
        last_error = 'expired', updated_at = ?
    WHERE status IN ('PENDING', 'SENDING') AND expires_at <= ?
  `).run(nowIso, nowIso);
  const staleClaimCutoff = new Date(now.getTime() - 2 * 60_000).toISOString();
  db.prepare(`
    UPDATE auth_email_outbox SET status = 'PENDING', next_attempt_at = ?, updated_at = ?
    WHERE status = 'SENDING' AND updated_at <= ? AND expires_at > ?
  `).run(nowIso, nowIso, staleClaimCutoff, nowIso);
  const rows = db.prepare(`
    SELECT id, magic_link_id, encrypted_payload, payload_iv, payload_tag, attempts, expires_at
    FROM auth_email_outbox
    WHERE status = 'PENDING' AND next_attempt_at <= ? AND expires_at > ?
    ORDER BY created_at ASC
    LIMIT ?
  `).all(nowIso, nowIso, limit) as OutboxRow[];
  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    const claimed = db.prepare(`UPDATE auth_email_outbox SET status = 'SENDING', updated_at = ? WHERE id = ? AND status = 'PENDING'`).run(nowIso, row.id);
    if (claimed.changes === 0) continue;
    const link = db.prepare(`
      SELECT id, token_hash, email, purpose, user_id, return_path, expires_at, consumed_at
      FROM auth_magic_links WHERE id = ?
    `).get(row.magic_link_id) as MagicLinkRow | undefined;
    if (!link || link.consumed_at || link.expires_at <= nowIso) {
      db.prepare(`UPDATE auth_email_outbox SET status = 'EXPIRED', encrypted_payload = NULL, payload_iv = NULL, payload_tag = NULL, last_error = 'expired', updated_at = ? WHERE id = ?`).run(nowIso, row.id);
      continue;
    }
    try {
      const { token } = decryptPayload(row, config.encryptionKey);
      const signInUrl = `${config.baseUrl.replace(/\/+$/, '')}/auth/email/confirm?token=${encodeURIComponent(token)}`;
      const result = await config.transport.sendMagicLink({ to: link.email, signInUrl, expiresAt: link.expires_at, purpose: link.purpose });
      db.prepare(`
        UPDATE auth_email_outbox
        SET status = 'SENT', attempts = attempts + 1, provider_message_id = ?, last_error = NULL,
            encrypted_payload = NULL, payload_iv = NULL, payload_tag = NULL, updated_at = ?
        WHERE id = ?
      `).run(result.messageId ?? null, nowIso, row.id);
      sent += 1;
    } catch {
      const attempts = row.attempts + 1;
      const terminal = attempts >= MAX_DELIVERY_ATTEMPTS;
      const retryAt = new Date(now.getTime() + Math.min(5 * 60_000, 30_000 * 2 ** row.attempts)).toISOString();
      db.prepare(`
        UPDATE auth_email_outbox
        SET status = ?, attempts = ?, next_attempt_at = ?, last_error = 'delivery_failed',
            encrypted_payload = CASE WHEN ? THEN NULL ELSE encrypted_payload END,
            payload_iv = CASE WHEN ? THEN NULL ELSE payload_iv END,
            payload_tag = CASE WHEN ? THEN NULL ELSE payload_tag END,
            updated_at = ?
        WHERE id = ?
      `).run(terminal ? 'FAILED' : 'PENDING', attempts, retryAt, terminal ? 1 : 0, terminal ? 1 : 0, terminal ? 1 : 0, nowIso, row.id);
      failed += 1;
    }
  }
  return { sent, failed, expired: expiredResult.changes };
}

export function prepareMagicLinkConfirmation(token: string, now = new Date()): { nonce: string; purpose: MagicLinkPurpose } | null {
  if (!token || token.length > 256) return null;
  const nowIso = now.toISOString();
  const link = db.prepare(`
    SELECT id, token_hash, email, purpose, user_id, return_path, expires_at, consumed_at
    FROM auth_magic_links WHERE token_hash = ?
  `).get(sha256(token)) as MagicLinkRow | undefined;
  if (!link || link.consumed_at || link.expires_at <= nowIso) return null;
  const nonce = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Math.min(Date.parse(link.expires_at), now.getTime() + CONFIRMATION_TTL_MS)).toISOString();
  db.prepare(`
    INSERT INTO auth_magic_link_confirmations (nonce_hash, magic_link_id, created_at, expires_at, consumed_at)
    VALUES (?, ?, ?, ?, NULL)
  `).run(sha256(nonce), link.id, nowIso, expiresAt);
  return { nonce, purpose: link.purpose };
}

function confirmationRows(nonce: string): { confirmation: ConfirmationRow; link: MagicLinkRow } | null {
  if (!nonce || nonce.length > 256) return null;
  const confirmation = db.prepare(`
    SELECT nonce_hash, magic_link_id, expires_at, consumed_at
    FROM auth_magic_link_confirmations WHERE nonce_hash = ?
  `).get(sha256(nonce)) as ConfirmationRow | undefined;
  if (!confirmation) return null;
  const link = db.prepare(`
    SELECT id, token_hash, email, purpose, user_id, return_path, expires_at, consumed_at
    FROM auth_magic_links WHERE id = ?
  `).get(confirmation.magic_link_id) as MagicLinkRow | undefined;
  return link ? { confirmation, link } : null;
}

export function magicLinkConfirmationState(nonce: string | undefined, now = new Date()): { purpose: MagicLinkPurpose; email: string } | null {
  if (!nonce) return null;
  const rows = confirmationRows(nonce);
  const nowIso = now.toISOString();
  if (!rows || rows.confirmation.consumed_at || rows.confirmation.expires_at <= nowIso || rows.link.consumed_at || rows.link.expires_at <= nowIso) return null;
  return { purpose: rows.link.purpose, email: rows.link.email };
}

export type RedeemMagicLinkResult =
  | { ok: true; userId: string; returnPath: string; purpose: MagicLinkPurpose }
  | { ok: false; code: 'INVALID_OR_EXPIRED' | 'AUTH_REQUIRED' | 'ACCOUNT_MISMATCH' | 'EMAIL_ALREADY_LINKED' | 'IDENTITY_CONFLICT' };

export function redeemMagicLink(input: { nonce: string; sessionUserId?: string; now?: Date }): RedeemMagicLinkResult {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  return db.transaction((): RedeemMagicLinkResult => {
    const rows = confirmationRows(input.nonce);
    if (!rows || rows.confirmation.consumed_at || rows.confirmation.expires_at <= nowIso || rows.link.consumed_at || rows.link.expires_at <= nowIso) {
      return { ok: false, code: 'INVALID_OR_EXPIRED' };
    }
    const { link } = rows;
    let userId: string;
    const existingEmail = getIdentity('EMAIL', link.email);
    if (link.purpose === 'LINK_EMAIL') {
      if (!input.sessionUserId) return { ok: false, code: 'AUTH_REQUIRED' };
      if (input.sessionUserId !== link.user_id) return { ok: false, code: 'ACCOUNT_MISMATCH' };
      const accountEmail = getIdentityForUser(input.sessionUserId, 'EMAIL');
      if (accountEmail && accountEmail.providerUserId !== link.email) return { ok: false, code: 'EMAIL_ALREADY_LINKED' };
      if (existingEmail && existingEmail.userId !== input.sessionUserId) return { ok: false, code: 'IDENTITY_CONFLICT' };
      if (!existingEmail) linkIdentity({ userId: input.sessionUserId, provider: 'EMAIL', providerUserId: link.email, email: link.email });
      userId = input.sessionUserId;
    } else if (existingEmail) {
      userId = existingEmail.userId;
    } else {
      const user = createUser();
      linkIdentity({ userId: user.id, provider: 'EMAIL', providerUserId: link.email, email: link.email });
      userId = user.id;
    }
    db.prepare('UPDATE auth_magic_links SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL').run(nowIso, link.id);
    db.prepare('UPDATE auth_magic_link_confirmations SET consumed_at = ? WHERE nonce_hash = ? AND consumed_at IS NULL').run(nowIso, rows.confirmation.nonce_hash);
    return { ok: true, userId, returnPath: link.return_path, purpose: link.purpose };
  })();
}

export function createPostmarkMagicLinkTransport(input: {
  serverToken: string;
  fromEmail: string;
  fetchImpl?: typeof fetch;
}): MagicLinkEmailTransport {
  return {
    async sendMagicLink(message) {
      const response = await (input.fetchImpl ?? fetch)('https://api.postmarkapp.com/email', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Postmark-Server-Token': input.serverToken
        },
        body: JSON.stringify({
          From: input.fromEmail,
          To: message.to,
          Subject: message.purpose === 'LINK_EMAIL' ? 'Verify your Vaultr email' : 'Sign in to Vaultr',
          TextBody: `Use this secure link to continue with Vaultr:\n\n${message.signInUrl}\n\nThis link expires in 15 minutes and can be used once.`,
          HtmlBody: `<p>Use this secure link to continue with Vaultr:</p><p><a href="${message.signInUrl}">Continue to Vaultr</a></p><p>This link expires in 15 minutes and can be used once.</p>`,
          MessageStream: 'outbound',
          TrackOpens: false,
          TrackLinks: 'None'
        })
      });
      if (!response.ok) throw new Error('postmark_delivery_failed');
      const body = await response.json() as { MessageID?: unknown };
      return { messageId: typeof body.MessageID === 'string' ? body.MessageID : undefined };
    }
  };
}
