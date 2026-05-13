import { alertsChannelSet } from './alerts-channel-set.js';
import { chaseAdd } from './chase-add.js';
import { chaseEdit } from './chase-edit.js';
import { chaseEditLatest } from './chase-edit-latest.js';
import { chaseList } from './chase-list.js';
import { chaseRemove } from './chase-remove.js';
import { chaseRemoveLatest } from './chase-remove-latest.js';
import { chaseTest } from './chase-test.js';
import { plan } from './plan.js';
import { planSet } from './plan-set.js';

export const commands = [
  alertsChannelSet,
  chaseAdd,
  chaseEdit,
  chaseEditLatest,
  chaseList,
  chaseRemove,
  chaseRemoveLatest,
  chaseTest,
  plan,
  planSet
];
