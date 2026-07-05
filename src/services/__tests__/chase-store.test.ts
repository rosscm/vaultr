import { describe, expect, it } from 'vitest';
import {
  addChase,
  getChaseLastPollAttemptAt,
  getChaseLastPollCheckAt,
  markChasesPollAttempted,
  markChasesPollChecked,
  removeAllChases
} from '../chase-store.js';

describe('chase poll state', () => {
  it('records a poll attempt separately from the last successful check', () => {
    const userId = 'poll-state-user';
    removeAllChases(userId);
    const chase = addChase({ userId, cardName: 'Mew-EX Legendary Treasures RC24' });

    markChasesPollChecked([chase.id], '2026-07-05T16:00:00.000Z');
    markChasesPollAttempted([chase.id], '2026-07-05T16:05:00.000Z');

    expect(getChaseLastPollCheckAt(chase.id)).toBe('2026-07-05T16:00:00.000Z');
    expect(getChaseLastPollAttemptAt(chase.id)).toBe('2026-07-05T16:05:00.000Z');

    removeAllChases(userId);
  });

  it('falls back to the last successful check when no separate attempt exists', () => {
    const userId = 'poll-state-fallback-user';
    removeAllChases(userId);
    const chase = addChase({ userId, cardName: 'Umbreon ex Terastal Festival 217/187' });

    markChasesPollChecked([chase.id], '2026-07-05T16:10:00.000Z');

    expect(getChaseLastPollAttemptAt(chase.id)).toBe('2026-07-05T16:10:00.000Z');

    removeAllChases(userId);
  });
});
