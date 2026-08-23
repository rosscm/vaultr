import { randomBytes } from 'node:crypto';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { getVaultChases, resolveUserChaseRemoval } from '../services/chase-service.js';
import type { Chase } from '../types.js';
import { errorEmbed, infoEmbed, successEmbed } from '../ui/embeds.js';
import { displayGrade } from '../ui/style.js';

const REMOVE_PREFIX = 'chase-remove';
const REMOVE_EXPIRY_MS = 15 * 60 * 1000;

type ChaseRemoveAction = 'COMPLETED' | 'NO_LONGER_INTERESTED' | 'ADDED_BY_MISTAKE' | 'CANCEL';
type ChaseRemoveResolution = {
  embeds: ReturnType<typeof successEmbed>[];
  components: ActionRowBuilder<ButtonBuilder>[];
};
type PendingChaseRemoval = {
  token: string;
  ownerUserId: string;
  chaseId: string;
  cardName: string;
  expiresAtMs: number;
  status: 'PENDING' | 'PROCESSING' | 'RESOLVED';
  resolution?: ChaseRemoveResolution;
};

const pendingChaseRemovals = new Map<string, PendingChaseRemoval>();
let chaseRemoveNow = () => Date.now();

function chaseChoiceName(chase: Chase): string {
  const details = [
    chase.maxPrice !== undefined ? `Max ${chase.maxPrice}` : undefined,
    chase.grade ? displayGrade(chase.grade) : undefined,
    chase.priority && chase.priority !== 'NORMAL' ? chase.priority : undefined
  ].filter(Boolean);
  const suffix = details.length > 0 ? ` — ${details.join(' · ')}` : '';
  return `${chase.cardName}${suffix}`.slice(0, 100);
}

function pruneExpiredPendingChaseRemovals(nowMs = chaseRemoveNow()): void {
  for (const [token, action] of pendingChaseRemovals.entries()) {
    if (action.expiresAtMs <= nowMs) pendingChaseRemovals.delete(token);
  }
}

function chaseRemovalButtons(ownerUserId: string, token: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${REMOVE_PREFIX}:${token}:COMPLETED`)
      .setLabel('Completed')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`${REMOVE_PREFIX}:${token}:NO_LONGER_INTERESTED`)
      .setLabel('No longer interested')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${REMOVE_PREFIX}:${token}:ADDED_BY_MISTAKE`)
      .setLabel('Added by mistake')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${REMOVE_PREFIX}:${token}:CANCEL`)
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Danger)
  );
}

function pendingRemovalEmbed(cardName: string) {
  return infoEmbed(
    'Remove Chase?',
    [
      `Select a reason for removing **${cardName}**`
    ].join('\n')
  );
}

function completedResolution(cardName: string): ChaseRemoveResolution {
  return {
    embeds: [
      successEmbed(
        'Chase Completed',
        `Removed **${cardName}** from your active chases and added it to your completed chase history.`
      ).setTitle('✅ Chase Completed')
    ],
    components: []
  };
}

function noLongerInterestedResolution(cardName: string): ChaseRemoveResolution {
  return {
    embeds: [
      successEmbed(
        'Chase Removed',
        `Removed **${cardName}** from your active chases. It was not marked as completed.`
      ).setTitle('✅ Chase Removed')
    ],
    components: []
  };
}

function addedByMistakeResolution(cardName: string): ChaseRemoveResolution {
  return {
    embeds: [
      successEmbed(
        'Chase Removed',
        `Removed **${cardName}** without changing your collector profile.`
      ).setTitle('✅ Chase Removed')
    ],
    components: []
  };
}

function cancelledResolution(cardName: string): ChaseRemoveResolution {
  return {
    embeds: [
      infoEmbed('Removal Cancelled', `Kept **${cardName}** in your active chases.`)
    ],
    components: []
  };
}

function expiredResolution(): ChaseRemoveResolution {
  return {
    embeds: [
      errorEmbed('Removal Expired', 'This removal prompt expired. No changes were made.')
    ],
    components: []
  };
}

function alreadyProcessingResolution(cardName: string): ChaseRemoveResolution {
  return {
    embeds: [
      infoEmbed('Removal In Progress', `Still processing **${cardName}**. No extra changes were made.`)
    ],
    components: []
  };
}

function removeFailedResolution(): ChaseRemoveResolution {
  return {
    embeds: [
      errorEmbed('Remove Failed', 'No chase was removed.')
    ],
    components: []
  };
}

export async function handleChaseRemoveAutocomplete(interaction: any): Promise<boolean> {
  if (!interaction.isAutocomplete()) return false;
  if (interaction.commandName !== 'chase') return false;
  if (interaction.options.getSubcommand() !== 'remove') return false;
  const focused = interaction.options.getFocused(true);
  if (focused.name !== 'chase') return false;

  const query = String(focused.value ?? '').trim().toLowerCase();
  const chases = getVaultChases(interaction.user.id).chases.map((view) => view.chase);
  const matches = chases
    .filter((chase, index) => {
      if (query.length === 0) return index < 25;
      return chase.cardName.toLowerCase().includes(query);
    })
    .slice(0, 25)
    .map((chase) => ({
      name: chaseChoiceName(chase),
      value: chase.id
    }));

  await interaction.respond(matches);
  return true;
}

export async function handleChaseRemoveButtons(interaction: any): Promise<boolean> {
  if (!interaction.isButton()) return false;
  if (!interaction.customId.startsWith(`${REMOVE_PREFIX}:`)) return false;

  pruneExpiredPendingChaseRemovals();
  const [, token, actionRaw] = interaction.customId.split(':');
  if (!token || !actionRaw) return false;

  const pending = pendingChaseRemovals.get(token);
  if (pending && interaction.user.id !== pending.ownerUserId) {
    await interaction.reply({
      content: 'Only the original requester can use these buttons',
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  if (!pending || pending.expiresAtMs <= chaseRemoveNow()) {
    pendingChaseRemovals.delete(token);
    const resolution = expiredResolution();
    await interaction.update(resolution);
    return true;
  }

  if (pending.status === 'RESOLVED' && pending.resolution) {
    await interaction.update(pending.resolution);
    return true;
  }

  if (pending.status === 'PROCESSING') {
    await interaction.update(alreadyProcessingResolution(pending.cardName));
    return true;
  }

  const action = normalizeChaseRemoveAction(actionRaw);
  if (!action) return false;
  if (action === 'CANCEL') {
    const resolution = cancelledResolution(pending.cardName);
    pending.status = 'RESOLVED';
    pending.resolution = resolution;
    await interaction.update(resolution);
    return true;
  }

  pending.status = 'PROCESSING';
  try {
    const resolved = resolveUserChaseRemoval({ userId: pending.ownerUserId, chaseId: pending.chaseId, outcome: action });
    const resolution = !resolved.ok
      ? removeFailedResolution()
      : action === 'COMPLETED'
        ? completedResolution(resolved.chase.cardName)
        : action === 'NO_LONGER_INTERESTED'
          ? noLongerInterestedResolution(resolved.chase.cardName)
          : addedByMistakeResolution(resolved.chase.cardName);
    pending.status = 'RESOLVED';
    pending.resolution = resolution;
    await interaction.update(resolution);
    return true;
  } catch {
    pending.status = 'PENDING';
    await interaction.update(removeFailedResolution());
    return true;
  }
}

function normalizeChaseRemoveAction(value: string): ChaseRemoveAction | null {
  if (value === 'COMPLETED' || value === 'NO_LONGER_INTERESTED' || value === 'ADDED_BY_MISTAKE' || value === 'CANCEL') {
    return value;
  }
  return null;
}

export const chaseRemove = {
  async execute(interaction: any) {
    pruneExpiredPendingChaseRemovals();
    const chaseId = interaction.options.getString('chase');
    const chases = getVaultChases(interaction.user.id).chases.map((view) => view.chase);

    if (chases.length === 0) {
      await interaction.reply({
        embeds: [errorEmbed('No Active Chases', 'There are no active chases to remove')],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (!chaseId) {
      await interaction.reply({
        embeds: [errorEmbed('Chase Required', 'Pick a current chase from `/chase remove` and try again')],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const target = chases.find((chase) => chase.id === chaseId);
    if (!target) {
      await interaction.reply({
        embeds: [errorEmbed('Chase Not Found', 'Pick a current chase from `/chase remove` and try again')],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const token = randomBytes(6).toString('base64url');
    pendingChaseRemovals.set(token, {
      token,
      ownerUserId: interaction.user.id,
      chaseId: target.id,
      cardName: target.cardName,
      expiresAtMs: chaseRemoveNow() + REMOVE_EXPIRY_MS,
      status: 'PENDING'
    });

    await interaction.reply({
      embeds: [pendingRemovalEmbed(target.cardName)],
      components: [chaseRemovalButtons(interaction.user.id, token)],
      flags: MessageFlags.Ephemeral
    });
  }
};

export const __chaseRemoveTestHooks = {
  clearPending(): void {
    pendingChaseRemovals.clear();
  },
  setNow(fn: (() => number) | null): void {
    chaseRemoveNow = fn ?? (() => Date.now());
  }
};
