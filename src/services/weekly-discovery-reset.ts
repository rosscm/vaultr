import { db } from './db.js';
import {
  deleteScheduledDiscoveryDrop,
  deleteScheduledDiscoveryDropAnnouncementsForPeriod,
  listScheduledDiscoveryDropAnnouncements,
  listScheduledDiscoveryDropsForPeriod,
  listScheduledDiscoveryDropsForUser,
  type ScheduledDiscoveryDrop
} from './scheduled-discovery-drops.js';
import {
  deleteWeeklyDiscoveryPreparationState,
  listWeeklyDiscoveryPreparationStatesForUser,
  type WeeklyDiscoveryPreparationState
} from './weekly-discovery-preparation-state.js';
import {
  deleteWeeklyDiscoveryPreparedReserve,
  listWeeklyDiscoveryPreparedReservesForUser,
  type WeeklyDiscoveryPreparedReserveRecord
} from './weekly-discovery-prepared-reserve.js';

const WEEKLY_DISCOVERY_DROP_TYPE = 'WEEKLY_DISCOVERY' as const;
const PERIOD_KEY_PATTERN = /^\d{4}-W\d{2}$/;

export type WeeklyDiscoveryResetScope =
  | { kind: 'PERIOD'; periodKey: string }
  | { kind: 'ALL_PERIODS' };

export type WeeklyDiscoveryResetUserSummary = {
  userId: string;
  periodKeys: string[];
  scheduledDropCount: number;
  preparationStateCount: number;
  preparedReserveCount: number;
  deliveryPublicationMarkerCount: number;
  wouldChange: boolean;
};

export type WeeklyDiscoveryResetPeriodAnnouncementSummary = {
  periodKey: string;
  announcementCount: number;
  willDelete: boolean;
  blockingUserIds: string[];
};

export type WeeklyDiscoveryResetPlan = {
  userIds: string[];
  scope: WeeklyDiscoveryResetScope;
  matchingPeriodKeys: string[];
  scheduledDropCount: number;
  preparationStateCount: number;
  preparedReserveCount: number;
  deliveryPublicationMarkerCount: number;
  announcementCount: number;
  wouldChange: boolean;
  users: WeeklyDiscoveryResetUserSummary[];
  periodAnnouncements: WeeklyDiscoveryResetPeriodAnnouncementSummary[];
  preserved: string[];
};

export type WeeklyDiscoveryResetResult = WeeklyDiscoveryResetPlan & {
  confirmed: boolean;
  deleted: {
    scheduledDrops: number;
    preparationStates: number;
    preparedReserves: number;
    deliveryPublicationMarkers: number;
    announcements: number;
  };
};

type ResettableRecords = {
  dropsByUser: Map<string, ScheduledDiscoveryDrop[]>;
  statesByUser: Map<string, WeeklyDiscoveryPreparationState[]>;
  reservesByUser: Map<string, WeeklyDiscoveryPreparedReserveRecord[]>;
};

function uniqueSorted(values: Iterable<string>): string[] {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}

function stateHasDeliveryPublicationMarker(state: WeeklyDiscoveryPreparationState): boolean {
  return (
    state.deliveryState !== 'NONE'
    || !!state.deliveredAt
    || !!state.announcementGuildId
    || !!state.announcementMessageId
    || !!state.lastDeliveryAttemptAt
    || !!state.deliveryError
    || state.ownerAlertSent
    || state.recoveredAfterRelease
    || !!state.leaseExpiresAt
    || !!state.nextRetryAt
    || state.preparationGeneration > 0
    || state.attemptCount > 0
    || !!state.lastOutcome
    || !!state.failureCode
    || !!state.failureSummary
  );
}

function preservedSummary(): string[] {
  return [
    'Vault/chase cards',
    'user plan and alert settings',
    'taste-memory chases',
    'MORE_LIKE_THIS and NOT_FOR_ME feedback',
    'discovery training examples',
    'general seen-history records',
    'canonical card references',
    'user/global discovery universe',
    'market caches and refresh queues',
    'other scheduled drop types',
    'Discord configuration'
  ];
}

export function isWeeklyDiscoveryPeriodKey(value: string): boolean {
  return PERIOD_KEY_PATTERN.test(value.trim());
}

function loadResettableRecords(userIds: string[]): ResettableRecords {
  const dropsByUser = new Map<string, ScheduledDiscoveryDrop[]>();
  const statesByUser = new Map<string, WeeklyDiscoveryPreparationState[]>();
  const reservesByUser = new Map<string, WeeklyDiscoveryPreparedReserveRecord[]>();
  for (const userId of userIds) {
    dropsByUser.set(userId, listScheduledDiscoveryDropsForUser(userId, WEEKLY_DISCOVERY_DROP_TYPE));
    statesByUser.set(userId, listWeeklyDiscoveryPreparationStatesForUser(userId));
    reservesByUser.set(userId, listWeeklyDiscoveryPreparedReservesForUser(userId));
  }
  return { dropsByUser, statesByUser, reservesByUser };
}

function matchingPeriodsForScope(records: ResettableRecords, userIds: string[], scope: WeeklyDiscoveryResetScope): string[] {
  if (scope.kind === 'PERIOD') return [scope.periodKey];
  const periodKeys = new Set<string>();
  for (const userId of userIds) {
    for (const drop of records.dropsByUser.get(userId) ?? []) periodKeys.add(drop.periodKey);
    for (const state of records.statesByUser.get(userId) ?? []) periodKeys.add(state.periodKey);
    for (const reserve of records.reservesByUser.get(userId) ?? []) periodKeys.add(reserve.periodKey);
  }
  return uniqueSorted(periodKeys);
}

function periodAnnouncementsForScope(targetUserIds: Set<string>, matchingPeriodKeys: string[]): WeeklyDiscoveryResetPeriodAnnouncementSummary[] {
  return matchingPeriodKeys.map((periodKey) => {
    const announcements = listScheduledDiscoveryDropAnnouncements(WEEKLY_DISCOVERY_DROP_TYPE, periodKey);
    const periodDrops = listScheduledDiscoveryDropsForPeriod(WEEKLY_DISCOVERY_DROP_TYPE, periodKey);
    const blockingUserIds = uniqueSorted(
      periodDrops
        .map((drop) => drop.userId)
        .filter((userId) => !targetUserIds.has(userId))
    );
    return {
      periodKey,
      announcementCount: announcements.length,
      willDelete: announcements.length > 0 && blockingUserIds.length === 0,
      blockingUserIds
    };
  });
}

export function buildWeeklyDiscoveryResetPlan(input: {
  userIds: string[];
  scope: WeeklyDiscoveryResetScope;
}): WeeklyDiscoveryResetPlan {
  const userIds = uniqueSorted(input.userIds.map((value) => value.trim()).filter(Boolean));
  const records = loadResettableRecords(userIds);
  const matchingPeriodKeys = matchingPeriodsForScope(records, userIds, input.scope);
  const targetPeriods = new Set(matchingPeriodKeys);
  const targetUserIds = new Set(userIds);
  const periodAnnouncements = periodAnnouncementsForScope(targetUserIds, matchingPeriodKeys);
  const users = userIds.map((userId) => {
    const drops = (records.dropsByUser.get(userId) ?? []).filter((drop) => targetPeriods.has(drop.periodKey));
    const states = (records.statesByUser.get(userId) ?? []).filter((state) => targetPeriods.has(state.periodKey));
    const reserves = (records.reservesByUser.get(userId) ?? []).filter((reserve) => targetPeriods.has(reserve.periodKey));
    const userPeriodKeys = uniqueSorted([
      ...drops.map((drop) => drop.periodKey),
      ...states.map((state) => state.periodKey),
      ...reserves.map((reserve) => reserve.periodKey)
    ]);
    const deliveryPublicationMarkerCount = states.filter(stateHasDeliveryPublicationMarker).length;
    return {
      userId,
      periodKeys: userPeriodKeys,
      scheduledDropCount: drops.length,
      preparationStateCount: states.length,
      preparedReserveCount: reserves.length,
      deliveryPublicationMarkerCount,
      wouldChange: drops.length > 0 || states.length > 0 || reserves.length > 0
    };
  });
  const scheduledDropCount = users.reduce((sum, user) => sum + user.scheduledDropCount, 0);
  const preparationStateCount = users.reduce((sum, user) => sum + user.preparationStateCount, 0);
  const preparedReserveCount = users.reduce((sum, user) => sum + user.preparedReserveCount, 0);
  const deliveryPublicationMarkerCount =
    users.reduce((sum, user) => sum + user.deliveryPublicationMarkerCount, 0)
    + periodAnnouncements.filter((announcement) => announcement.willDelete).reduce((sum, announcement) => sum + announcement.announcementCount, 0);
  const announcementCount = periodAnnouncements.reduce((sum, announcement) => sum + announcement.announcementCount, 0);
  return {
    userIds,
    scope: input.scope,
    matchingPeriodKeys,
    scheduledDropCount,
    preparationStateCount,
    preparedReserveCount,
    deliveryPublicationMarkerCount,
    announcementCount,
    wouldChange:
      scheduledDropCount > 0
      || preparationStateCount > 0
      || preparedReserveCount > 0
      || periodAnnouncements.some((announcement) => announcement.willDelete),
    users,
    periodAnnouncements,
    preserved: preservedSummary()
  };
}

export function applyWeeklyDiscoveryReset(input: {
  userIds: string[];
  scope: WeeklyDiscoveryResetScope;
  confirm?: boolean;
}): WeeklyDiscoveryResetResult {
  const plan = buildWeeklyDiscoveryResetPlan({ userIds: input.userIds, scope: input.scope });
  if (input.confirm !== true) {
    return {
      ...plan,
      confirmed: false,
      deleted: {
        scheduledDrops: 0,
        preparationStates: 0,
        preparedReserves: 0,
        deliveryPublicationMarkers: 0,
        announcements: 0
      }
    };
  }

  const deleteRows = db.transaction(() => {
    let deletedAnnouncements = 0;
    for (const user of plan.users) {
      for (const periodKey of user.periodKeys) {
        deleteWeeklyDiscoveryPreparedReserve(user.userId, periodKey);
        deleteWeeklyDiscoveryPreparationState(user.userId, periodKey);
        deleteScheduledDiscoveryDrop(user.userId, WEEKLY_DISCOVERY_DROP_TYPE, periodKey);
      }
    }
    for (const announcement of plan.periodAnnouncements) {
      if (!announcement.willDelete) continue;
      deletedAnnouncements += deleteScheduledDiscoveryDropAnnouncementsForPeriod(WEEKLY_DISCOVERY_DROP_TYPE, announcement.periodKey);
    }
    return deletedAnnouncements;
  });

  const deletedAnnouncements = deleteRows();
  return {
    ...plan,
    confirmed: true,
    deleted: {
      scheduledDrops: plan.scheduledDropCount,
      preparationStates: plan.preparationStateCount,
      preparedReserves: plan.preparedReserveCount,
      deliveryPublicationMarkers: plan.deliveryPublicationMarkerCount,
      announcements: deletedAnnouncements
    }
  };
}
