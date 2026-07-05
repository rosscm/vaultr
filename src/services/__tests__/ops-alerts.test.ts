import { describe, expect, it } from 'vitest';
import { failureFingerprint, shouldSuppressDuplicateAlert } from '../ops-alerts.js';

describe('ops alerts', () => {
  it('treats chase freshness drifts as the same incident fingerprint', () => {
    const left = failureFingerprint([
      {
        name: 'chase-freshness',
        details: '11/15 active chases over 4x interval without poll attempt; worst Squirtle Japanese Promo 007/018 (897m overdue, 15m interval)'
      }
    ]);
    const right = failureFingerprint([
      {
        name: 'chase-freshness',
        details: '15/15 active chases over 4x interval without poll attempt; worst Mew XY Black Star Promos XY192 (933m overdue, 15m interval)'
      }
    ]);

    expect(left).toBe(right);
  });

  it('suppresses repeats indefinitely by default for the same incident', () => {
    expect(
      shouldSuppressDuplicateAlert(
        { lastFailureFingerprint: 'same', lastAlertedAt: '2026-07-05T01:00:00.000Z' },
        'same',
        new Date('2026-07-05T12:00:00.000Z').getTime(),
        0
      )
    ).toBe(true);
  });

  it('allows repeats after the configured repeat window elapses', () => {
    expect(
      shouldSuppressDuplicateAlert(
        { lastFailureFingerprint: 'same', lastAlertedAt: '2026-07-05T01:00:00.000Z' },
        'same',
        new Date('2026-07-05T03:30:00.000Z').getTime(),
        60
      )
    ).toBe(false);
  });
});

