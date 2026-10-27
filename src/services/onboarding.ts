import { db } from './db.js';
import { listChases } from './chase-store.js';

export type OnboardingStatus = 'IN_PROGRESS' | 'SKIPPED' | 'COMPLETED';
export type OnboardingStep = 'WELCOME' | 'MARKET' | 'PROFILE' | 'CHASE' | 'READY';
export type OnboardingAction = 'CONTINUE' | 'BACK' | 'MARKET_SAVED' | 'PROFILE_SAVED' | 'CHASE_CREATED' | 'SKIP' | 'FINISH' | 'RESUME';

export type OnboardingState = {
  status: OnboardingStatus;
  step: OnboardingStep;
  automatic: boolean;
  hasChase: boolean;
  updatedAt: string;
};

type Row = { status: OnboardingStatus; step: OnboardingStep; updated_at: string };

const getStmt = db.prepare('SELECT status, step, updated_at FROM user_onboarding WHERE user_id = ?');
const insertStmt = db.prepare(`
  INSERT INTO user_onboarding (user_id, status, step, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?)
`);
const updateStmt = db.prepare(`
  UPDATE user_onboarding SET status = ?, step = ?, updated_at = ? WHERE user_id = ?
`);

function publicState(userId: string, row: Row): OnboardingState {
  return {
    status: row.status,
    step: row.step,
    automatic: row.status === 'IN_PROGRESS',
    hasChase: listChases(userId).length > 0,
    updatedAt: row.updated_at
  };
}

export function getOrCreateOnboardingState(userId: string): OnboardingState {
  return db.transaction(() => {
    let row = getStmt.get(userId) as Row | undefined;
    const hasChase = listChases(userId).length > 0;
    if (!row) {
      const now = new Date().toISOString();
      const status: OnboardingStatus = hasChase ? 'SKIPPED' : 'IN_PROGRESS';
      insertStmt.run(userId, status, 'WELCOME', now, now);
      row = { status, step: 'WELCOME', updated_at: now };
    } else if (row.status === 'IN_PROGRESS' && row.step === 'CHASE' && hasChase) {
      const now = new Date().toISOString();
      updateStmt.run('IN_PROGRESS', 'READY', now, userId);
      row = { status: 'IN_PROGRESS', step: 'READY', updated_at: now };
    }
    return publicState(userId, row);
  })();
}

export type OnboardingTransitionResult =
  | { ok: true; state: OnboardingState }
  | { ok: false; code: 'INVALID_TRANSITION' | 'STALE_STATE'; state: OnboardingState };

export function transitionOnboarding(userId: string, action: OnboardingAction, expectedStep?: OnboardingStep): OnboardingTransitionResult {
  return db.transaction((): OnboardingTransitionResult => {
    const current = getOrCreateOnboardingState(userId);
    if (expectedStep && current.step !== expectedStep) return { ok: false as const, code: 'STALE_STATE' as const, state: current };
    if (current.status === 'COMPLETED') {
      if (action === 'FINISH') return { ok: true, state: current };
      return { ok: false, code: 'INVALID_TRANSITION', state: current };
    }
    if (current.status === 'SKIPPED' && action !== 'RESUME') {
      if (action === 'SKIP') return { ok: true, state: current };
      return { ok: false, code: 'INVALID_TRANSITION', state: current };
    }

    let status: OnboardingStatus = current.status;
    let step: OnboardingStep = current.step;
    if (action === 'SKIP') status = 'SKIPPED';
    else if (action === 'RESUME') {
      status = 'IN_PROGRESS';
      step = current.hasChase ? 'READY' : 'WELCOME';
    } else if (action === 'CONTINUE' && step === 'WELCOME') step = 'MARKET';
    else if (action === 'BACK' && step === 'MARKET') step = 'WELCOME';
    else if (action === 'BACK' && step === 'PROFILE') step = 'MARKET';
    else if (action === 'BACK' && step === 'CHASE') step = 'PROFILE';
    else if (action === 'BACK' && step === 'READY') step = 'PROFILE';
    else if (action === 'MARKET_SAVED' && step === 'MARKET') step = 'PROFILE';
    else if (action === 'PROFILE_SAVED' && step === 'PROFILE') step = current.hasChase ? 'READY' : 'CHASE';
    else if (action === 'CHASE_CREATED' && step === 'CHASE' && current.hasChase) step = 'READY';
    else if (action === 'FINISH' && step === 'READY') status = 'COMPLETED';
    else return { ok: false, code: 'INVALID_TRANSITION', state: current };

    const now = new Date().toISOString();
    updateStmt.run(status, step, now, userId);
    return { ok: true, state: getOrCreateOnboardingState(userId) };
  })();
}
