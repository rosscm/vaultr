import { alertsChannelSet } from './alerts-channel-set.js';
import { chaseAdd } from './chase-add.js';
import { chaseEdit } from './chase-edit.js';
import { chaseList } from './chase-list.js';
import { chaseRemove } from './chase-remove.js';
import { chaseTest } from './chase-test.js';
import { plan } from './plan.js';
import { planSet } from './plan-set.js';

export const commands = [
  alertsChannelSet,
  chaseAdd,
  chaseEdit,
  chaseList,
  chaseRemove,
  chaseTest,
  plan,
  planSet
];
