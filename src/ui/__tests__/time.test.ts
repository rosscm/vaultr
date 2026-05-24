import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatAgeSince } from '../time.js';

describe('formatAgeSince', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('formats past times', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-24T21:00:00.000Z'));
    expect(formatAgeSince('2026-05-24T20:55:00.000Z')).toBe('5m ago');
  });

  it('formats future times', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-24T21:00:00.000Z'));
    expect(formatAgeSince('2026-05-24T21:05:00.000Z')).toBe('in 5m');
  });
});
