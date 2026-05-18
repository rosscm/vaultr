import { alertsSettings } from './alerts-settings.js';
import { alertsSettingsReset } from './alerts-settings-reset.js';
import { alertsRecent } from './alerts-recent.js';
import { communityFeed } from './community-feed.js';
import { chaseAdd } from './chase-add.js';
import { chaseEdit } from './chase-edit.js';
import { chaseList } from './chase-list.js';
import { chaseRemove } from './chase-remove.js';
import { chaseTest } from './chase-test.js';
import { help } from './help.js';
import { plan } from './plan.js';
import { planSet } from './plan-set.js';
import { setupChannelSet } from './setup-channel-set.js';
import { status } from './status.js';
import { upgrade } from './upgrade.js';

export const commands = [
  alertsRecent,
  alertsSettings,
  alertsSettingsReset,
  communityFeed,
  chaseAdd,
  chaseEdit,
  chaseList,
  chaseRemove,
  chaseTest,
  help,
  plan,
  planSet,
  setupChannelSet,
  status,
  upgrade
];
