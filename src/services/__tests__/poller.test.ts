import { describe, expect, it } from 'vitest';
import { isDueForPollInterval, orderGroupsForRun } from '../poller.js';

describe('orderGroupsForRun', () => {
  it('prioritizes groups that have never consumed a source fetch', () => {
    const ordered = orderGroupsForRun([
      {
        queryKey: 'luffy',
        group: { members: [], oldestCreatedAt: '2026-05-24T23:25:23.575Z' },
        lastSourceFetchAtMs: 100
      },
      {
        queryKey: 'squirtle',
        group: { members: [], oldestCreatedAt: '2026-05-24T20:59:39.622Z' }
      }
    ]);

    expect(ordered.map((entry) => entry.queryKey)).toEqual(['squirtle', 'luffy']);
  });

  it('prioritizes the least recently serviced group', () => {
    const ordered = orderGroupsForRun([
      {
        queryKey: 'luffy',
        group: { members: [], oldestCreatedAt: '2026-05-24T23:25:23.575Z' },
        lastSourceFetchAtMs: 200
      },
      {
        queryKey: 'squirtle',
        group: { members: [], oldestCreatedAt: '2026-05-24T20:59:39.622Z' },
        lastSourceFetchAtMs: 100
      }
    ]);

    expect(ordered.map((entry) => entry.queryKey)).toEqual(['squirtle', 'luffy']);
  });

  it('breaks ties with the oldest chase creation time', () => {
    const ordered = orderGroupsForRun([
      {
        queryKey: 'luffy',
        group: { members: [], oldestCreatedAt: '2026-05-24T23:25:23.575Z' }
      },
      {
        queryKey: 'squirtle',
        group: { members: [], oldestCreatedAt: '2026-05-24T20:59:39.622Z' }
      }
    ]);

    expect(ordered.map((entry) => entry.queryKey)).toEqual(['squirtle', 'luffy']);
  });
});

describe('isDueForPollInterval', () => {
  it('treats uninitialized chases as due immediately', () => {
    expect(isDueForPollInterval(undefined, 900, 1_000)).toBe(true);
  });

  it('blocks checks until the interval window has elapsed', () => {
    expect(isDueForPollInterval(1_000, 1800, 1_000 + 1_799_000)).toBe(false);
  });

  it('allows checks once the interval window has elapsed', () => {
    expect(isDueForPollInterval(1_000, 900, 1_000 + 900_000)).toBe(true);
  });
});