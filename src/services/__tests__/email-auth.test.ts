import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createUser, getIdentity, linkIdentity } from '../accounts.js';
import { db } from '../db.js';
import {
  magicLinkConfirmationState,
  normalizeEmailAddress,
  prepareMagicLinkConfirmation,
  processPendingMagicLinkEmails,
  redeemMagicLink,
  requestMagicLink,
  safeAuthReturnPath,
  type EmailAuthConfig,
  type MagicLinkEmail
} from '../email-auth.js';
import { getOrCreateOnboardingState } from '../onboarding.js';

const encryptionKey = Buffer.alloc(32, 7);
let delivered: MagicLinkEmail[];
let sendMagicLink: ReturnType<typeof vi.fn>;
let config: EmailAuthConfig;
let issueCounter = 0;

function clearAuth(): void {
  db.prepare('DELETE FROM auth_email_outbox').run();
  db.prepare('DELETE FROM auth_magic_link_confirmations').run();
  db.prepare('DELETE FROM auth_magic_links').run();
}

function tokenFrom(message: MagicLinkEmail): string {
  return new URL(message.signInUrl).searchParams.get('token')!;
}

async function issue(email: string, options: { purpose?: 'SIGN_IN' | 'LINK_EMAIL'; userId?: string; now?: Date } = {}) {
  const now = options.now ?? new Date('2026-10-16T12:00:00.000Z');
  const result = requestMagicLink({
    email,
    purpose: options.purpose ?? 'SIGN_IN',
    userId: options.userId,
    ipAddress: `198.51.100.${++issueCounter}`,
    config,
    now
  });
  await processPendingMagicLinkEmails(config, { now });
  return { result, message: delivered.at(-1)! };
}

beforeEach(() => {
  clearAuth();
  issueCounter = 0;
  delivered = [];
  sendMagicLink = vi.fn(async (message: MagicLinkEmail) => {
    delivered.push(message);
    return { messageId: `postmark-${delivered.length}` };
  });
  config = { baseUrl: 'https://vaultr.example', encryptionKey, transport: { sendMagicLink } };
});

describe('email magic-link authentication', () => {
  it('normalizes conservatively and rejects unsafe return destinations', () => {
    expect(normalizeEmailAddress('  Collector+vault@Example.COM ')).toBe('collector+vault@example.com');
    expect(normalizeEmailAddress('not-an-email')).toBeNull();
    expect(safeAuthReturnPath('/app#settings')).toBe('/app#settings');
    expect(safeAuthReturnPath('https://evil.example/app')).toBe('/app');
    expect(safeAuthReturnPath('//evil.example/app')).toBe('/app');
  });

  it('stores token hashes and encrypted outbox payloads, then creates an email-only account on redemption', async () => {
    const { message } = await issue('NewCollector@Example.com');
    const token = tokenFrom(message);
    const link = db.prepare('SELECT token_hash, email FROM auth_magic_links').get() as { token_hash: string; email: string };
    const outbox = db.prepare('SELECT encrypted_payload, payload_iv, payload_tag, status FROM auth_email_outbox').get() as Record<string, string | null>;
    expect(link.email).toBe('newcollector@example.com');
    expect(link.token_hash).not.toBe(token);
    expect(JSON.stringify(outbox)).not.toContain(token);
    expect(outbox).toMatchObject({ encrypted_payload: null, payload_iv: null, payload_tag: null, status: 'SENT' });

    const prepared = prepareMagicLinkConfirmation(token, new Date('2026-10-16T12:01:00.000Z'))!;
    const competingConfirmation = prepareMagicLinkConfirmation(token, new Date('2026-10-16T12:01:30.000Z'))!;
    expect(magicLinkConfirmationState(prepared.nonce, new Date('2026-10-16T12:01:00.000Z'))).toMatchObject({ purpose: 'SIGN_IN' });
    const redeemed = redeemMagicLink({ nonce: prepared.nonce, now: new Date('2026-10-16T12:02:00.000Z') });
    expect(redeemed.ok).toBe(true);
    if (!redeemed.ok) return;
    expect(getIdentity('EMAIL', 'newcollector@example.com')?.userId).toBe(redeemed.userId);
    expect(getOrCreateOnboardingState(redeemed.userId)).toMatchObject({ status: 'IN_PROGRESS', step: 'WELCOME' });
    expect(redeemMagicLink({ nonce: prepared.nonce, now: new Date('2026-10-16T12:03:00.000Z') })).toEqual({ ok: false, code: 'INVALID_OR_EXPIRED' });
    expect(redeemMagicLink({ nonce: competingConfirmation.nonce, now: new Date('2026-10-16T12:03:00.000Z') })).toEqual({ ok: false, code: 'INVALID_OR_EXPIRED' });
  });

  it('signs an existing email identity into its original account without creating another identity', async () => {
    const user = createUser({ displayName: 'Existing Collector' });
    linkIdentity({ userId: user.id, provider: 'EMAIL', providerUserId: 'existing@example.com', email: 'existing@example.com' });
    const { message } = await issue('existing@example.com');
    const prepared = prepareMagicLinkConfirmation(tokenFrom(message), new Date('2026-10-16T12:01:00.000Z'))!;
    expect(redeemMagicLink({ nonce: prepared.nonce, now: new Date('2026-10-16T12:02:00.000Z') })).toMatchObject({ ok: true, userId: user.id });
    expect((db.prepare(`SELECT COUNT(*) AS count FROM user_identities WHERE provider = 'EMAIL' AND provider_user_id = ?`).get('existing@example.com') as { count: number }).count).toBe(1);
  });

  it('does not consume links on GET preparation and rejects expired confirmation', async () => {
    const now = new Date('2026-10-16T12:00:00.000Z');
    const { message } = await issue('expires@example.com', { now });
    const token = tokenFrom(message);
    const first = prepareMagicLinkConfirmation(token, new Date('2026-10-16T12:01:00.000Z'));
    const second = prepareMagicLinkConfirmation(token, new Date('2026-10-16T12:02:00.000Z'));
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(prepareMagicLinkConfirmation(token, new Date('2026-10-16T12:16:00.000Z'))).toBeNull();
    expect(redeemMagicLink({ nonce: first!.nonce, now: new Date('2026-10-16T12:16:00.000Z') })).toEqual({ ok: false, code: 'INVALID_OR_EXPIRED' });
  });

  it('binds email linking to the requesting account and rejects identity conflicts', async () => {
    const owner = createUser({ displayName: 'Owner' });
    const other = createUser({ displayName: 'Other' });
    linkIdentity({ userId: other.id, provider: 'EMAIL', providerUserId: 'claimed@example.com', email: 'claimed@example.com' });
    const { message } = await issue('claimed@example.com', { purpose: 'LINK_EMAIL', userId: owner.id });
    const prepared = prepareMagicLinkConfirmation(tokenFrom(message), new Date('2026-10-16T12:01:00.000Z'))!;
    expect(redeemMagicLink({ nonce: prepared.nonce, now: new Date('2026-10-16T12:02:00.000Z') })).toEqual({ ok: false, code: 'AUTH_REQUIRED' });
    expect(redeemMagicLink({ nonce: prepared.nonce, sessionUserId: other.id, now: new Date('2026-10-16T12:02:00.000Z') })).toEqual({ ok: false, code: 'ACCOUNT_MISMATCH' });
    expect(redeemMagicLink({ nonce: prepared.nonce, sessionUserId: owner.id, now: new Date('2026-10-16T12:02:00.000Z') })).toEqual({ ok: false, code: 'IDENTITY_CONFLICT' });
    expect(getIdentity('EMAIL', 'claimed@example.com')?.userId).toBe(other.id);
  });

  it('durably rate limits requests without changing the accepted response', () => {
    const now = new Date('2026-10-16T12:00:00.000Z');
    const results = Array.from({ length: 6 }, (_, index) => requestMagicLink({
      email: 'limited@example.com',
      purpose: 'SIGN_IN',
      ipAddress: `203.0.113.${index}`,
      config,
      now: new Date(now.getTime() + index)
    }));
    expect(results.slice(0, 5)).toEqual(Array(5).fill({ accepted: true, queued: true }));
    expect(results[5]).toEqual({ accepted: true, queued: false });
  });

  it('makes a repeated request issue a fresh token while delivery retries keep the same token', async () => {
    const now = new Date('2026-10-16T12:00:00.000Z');
    const first = await issue('repeat@example.com', { now });
    const firstToken = tokenFrom(first.message);
    const second = await issue('repeat@example.com', { now: new Date(now.getTime() + 1000) });
    const secondToken = tokenFrom(second.message);
    expect(secondToken).not.toBe(firstToken);
    expect(prepareMagicLinkConfirmation(firstToken, new Date(now.getTime() + 2000))).toBeNull();
    expect(prepareMagicLinkConfirmation(secondToken, new Date(now.getTime() + 2000))).not.toBeNull();
  });

  it('retains encrypted payload for bounded retry and erases it after success or expiry', async () => {
    sendMagicLink.mockRejectedValueOnce(new Error('provider exposed secret should not persist'));
    const now = new Date('2026-10-16T12:00:00.000Z');
    requestMagicLink({ email: 'retry@example.com', purpose: 'SIGN_IN', ipAddress: '192.0.2.9', config, now });
    await processPendingMagicLinkEmails(config, { now });
    expect(db.prepare('SELECT status, attempts, last_error, encrypted_payload IS NOT NULL AS retained FROM auth_email_outbox').get()).toEqual({ status: 'PENDING', attempts: 1, last_error: 'delivery_failed', retained: 1 });
    await processPendingMagicLinkEmails(config, { now: new Date(now.getTime() + 31_000) });
    expect(db.prepare('SELECT status, attempts, encrypted_payload FROM auth_email_outbox').get()).toEqual({ status: 'SENT', attempts: 2, encrypted_payload: null });

    requestMagicLink({ email: 'stale@example.com', purpose: 'SIGN_IN', ipAddress: '192.0.2.10', config, now });
    db.prepare(`UPDATE auth_email_outbox SET status = 'SENDING' WHERE status = 'PENDING'`).run();
    await processPendingMagicLinkEmails(config, { now: new Date(now.getTime() + 16 * 60_000) });
    expect(db.prepare(`SELECT status, encrypted_payload FROM auth_email_outbox WHERE status = 'EXPIRED'`).get()).toEqual({ status: 'EXPIRED', encrypted_payload: null });
  });
});
