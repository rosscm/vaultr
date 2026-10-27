import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { createUser } from '../accounts.js';
import { addChase, listChases, removeAllChases } from '../chase-store.js';
import { db, migrateWebOnboarding } from '../db.js';
import { getOrCreateOnboardingState, transitionOnboarding } from '../onboarding.js';

const users = new Set<string>();

function newUser(label: string): string {
  const user = createUser({ displayName: label });
  users.add(user.id);
  return user.id;
}

afterEach(() => {
  for (const userId of users) {
    removeAllChases(userId);
    db.prepare('DELETE FROM user_onboarding WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  }
  users.clear();
});

describe('web onboarding', () => {
  it('exempts rollout-existing accounts once without exempting accounts created later', () => {
    const database = new Database(':memory:');
    database.exec(`CREATE TABLE users (id TEXT PRIMARY KEY); INSERT INTO users (id) VALUES ('existing');`);

    migrateWebOnboarding(database);
    expect(database.prepare('SELECT status FROM user_onboarding WHERE user_id = ?').get('existing')).toEqual({ status: 'SKIPPED' });

    database.prepare('INSERT INTO users (id) VALUES (?)').run('new-after-rollout');
    migrateWebOnboarding(database);
    expect(database.prepare('SELECT status FROM user_onboarding WHERE user_id = ?').get('new-after-rollout')).toBeUndefined();
    expect((database.prepare('SELECT COUNT(*) AS count FROM app_migrations').get() as { count: number }).count).toBe(1);
    database.close();
  });

  it('enrolls a new empty account but exempts a new account that already has a Chase', () => {
    const empty = newUser('Empty collector');
    const existingChase = newUser('Collector with Chase');
    addChase({ userId: existingChase, cardName: 'Mew RC24' });

    expect(getOrCreateOnboardingState(empty)).toMatchObject({ status: 'IN_PROGRESS', step: 'WELCOME', automatic: true, hasChase: false });
    expect(getOrCreateOnboardingState(existingChase)).toMatchObject({ status: 'SKIPPED', automatic: false, hasChase: true });
  });

  it('persists guarded progress, reconciles an interrupted Chase creation, and completes idempotently', () => {
    const userId = newUser('Progress collector');
    expect(transitionOnboarding(userId, 'CONTINUE', 'WELCOME')).toMatchObject({ ok: true, state: { step: 'MARKET' } });
    expect(transitionOnboarding(userId, 'MARKET_SAVED', 'MARKET')).toMatchObject({ ok: true, state: { step: 'PROFILE' } });
    expect(transitionOnboarding(userId, 'PROFILE_SAVED', 'PROFILE')).toMatchObject({ ok: true, state: { step: 'CHASE' } });
    expect(transitionOnboarding(userId, 'BACK', 'WELCOME')).toMatchObject({ ok: false, code: 'STALE_STATE', state: { step: 'CHASE' } });

    addChase({ userId, cardName: 'Pichu Expedition 22/165' });
    expect(getOrCreateOnboardingState(userId)).toMatchObject({ step: 'READY', hasChase: true });
    expect(listChases(userId)).toHaveLength(1);
    expect(transitionOnboarding(userId, 'CHASE_CREATED', 'CHASE')).toMatchObject({ ok: false, code: 'STALE_STATE', state: { step: 'READY' } });
    expect(transitionOnboarding(userId, 'FINISH', 'READY')).toMatchObject({ ok: true, state: { status: 'COMPLETED' } });
    expect(transitionOnboarding(userId, 'FINISH', 'READY')).toMatchObject({ ok: true, state: { status: 'COMPLETED' } });
    expect(transitionOnboarding(userId, 'RESUME')).toMatchObject({ ok: false, state: { status: 'COMPLETED' } });
  });

  it('preserves each successfully saved step across later reads', () => {
    const userId = newUser('Resuming collector');
    expect(getOrCreateOnboardingState(userId).step).toBe('WELCOME');
    expect(getOrCreateOnboardingState(userId).step).toBe('WELCOME');

    transitionOnboarding(userId, 'CONTINUE', 'WELCOME');
    expect(getOrCreateOnboardingState(userId)).toMatchObject({ status: 'IN_PROGRESS', step: 'MARKET' });
    expect(getOrCreateOnboardingState(userId).step).toBe('MARKET');

    transitionOnboarding(userId, 'MARKET_SAVED', 'MARKET');
    expect(getOrCreateOnboardingState(userId)).toMatchObject({ status: 'IN_PROGRESS', step: 'PROFILE' });
    transitionOnboarding(userId, 'PROFILE_SAVED', 'PROFILE');
    expect(getOrCreateOnboardingState(userId)).toMatchObject({ status: 'IN_PROGRESS', step: 'CHASE' });
    expect(getOrCreateOnboardingState(userId).step).toBe('CHASE');

    addChase({ userId, cardName: 'Mew CoroCoro Promo 151' });
    expect(getOrCreateOnboardingState(userId)).toMatchObject({ status: 'IN_PROGRESS', step: 'READY', hasChase: true });
    expect(getOrCreateOnboardingState(userId).step).toBe('READY');
    expect(listChases(userId)).toHaveLength(1);
  });

  it('persists Skip and resumes manually without requiring another Chase', () => {
    const userId = newUser('Skipped collector');
    expect(transitionOnboarding(userId, 'SKIP', 'WELCOME')).toMatchObject({ ok: true, state: { status: 'SKIPPED' } });
    expect(getOrCreateOnboardingState(userId).status).toBe('SKIPPED');
    addChase({ userId, cardName: 'Gardevoir ex 233/091' });
    expect(transitionOnboarding(userId, 'RESUME')).toMatchObject({ ok: true, state: { status: 'IN_PROGRESS', step: 'READY' } });
  });

  it('keeps onboarding state isolated by internal account id', () => {
    const first = newUser('First collector');
    const second = newUser('Second collector');
    transitionOnboarding(first, 'CONTINUE', 'WELCOME');
    expect(getOrCreateOnboardingState(first).step).toBe('MARKET');
    expect(getOrCreateOnboardingState(second).step).toBe('WELCOME');
  });
});
