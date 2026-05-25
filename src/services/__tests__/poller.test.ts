import { describe, expect, it } from 'vitest';
import { orderGroupsForRun } from '../poller.js';

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