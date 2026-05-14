import { alertsChannelSet } from './alerts-channel-set.js';
import { alertsSettings } from './alerts-settings.js';
import { chaseAdd } from './chase-add.js';
import { chaseEdit } from './chase-edit.js';
import { chaseList } from './chase-list.js';
import { chaseRemove } from './chase-remove.js';
import { chaseTest } from './chase-test.js';
import { plan } from './plan.js';
import { planSet } from './plan-set.js';
import { status } from './status.js';

export const commands = [
  alertsChannelSet,
  alertsSettings,
  chaseAdd,
  chaseEdit,
  chaseList,
  chaseRemove,
  chaseTest,
  plan,
  planSet,
  status
];
