import { alertsSettings } from './alerts-settings.js';
import { alertsSettingsReset } from './alerts-settings-reset.js';
import { alertsRecent } from './alerts-recent.js';
import { chaseAdd } from './chase-add.js';
import { chaseEdit } from './chase-edit.js';
import { chaseList } from './chase-list.js';
import { chaseRemove } from './chase-remove.js';
import { chaseTest } from './chase-test.js';
import { plan } from './plan.js';
import { planSet } from './plan-set.js';
import { setupChannelSet } from './setup-channel-set.js';
import { status } from './status.js';
import { upgrade } from './upgrade.js';

export const commands = [
  alertsRecent,
  alertsSettings,
  alertsSettingsReset,
  chaseAdd,
  chaseEdit,
  chaseList,
  chaseRemove,
  chaseTest,
  plan,
  planSet,
  setupChannelSet,
  status,
  upgrade
];
