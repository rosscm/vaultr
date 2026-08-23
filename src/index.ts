import 'dotenv/config';
import { Client, Events, GatewayIntentBits, MessageFlags, type ChatInputCommandInteraction, type Interaction, type InteractionReplyOptions } from 'discord.js';
import { commands } from './commands/index.js';
import { handleAlertFeedback } from './commands/alert-feedback.js';
import { handleAlertSourceButtons } from './commands/alerts-settings.js';
import { handleChaseAddAutocomplete } from './commands/chase-add.js';
import { handleChaseEditAutocomplete } from './commands/chase-edit.js';
import { handleChaseListPagination } from './commands/chase-list.js';
import { handleChaseRemoveAutocomplete, handleChaseRemoveButtons } from './commands/chase-remove.js';
import { handleDiscoveryActionSelect, handleDiscoveryDropOpen, handleDiscoveryDropPage, handleDiscoveryFeedback, handleDiscoveryFeedbackUndo, handleDiscoveryVaultAdd } from './commands/discover.js';
import { initializeCurrencyRates } from './services/currency.js';
import { backfillChaseQueryNames } from './services/chase-store.js';
import { getGuildCommandChannel } from './services/chase-store.js';
import { startDiscoveryDropScheduler } from './services/discovery-drop-scheduler.js';
import { startPoller } from './services/poller.js';
import { productScopedInteraction } from './services/discord-account-adapter.js';
import { errorEmbed, warningEmbed } from './ui/embeds.js';

const token = process.env.DISCORD_TOKEN;

if (!token) {
  throw new Error('Missing DISCORD_TOKEN in environment');
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const commandMap = new Map(commands.map((c) => [c.data.name, c]));
const accountScopedCommands = new Set(['alerts', 'chase', 'discover', 'plan', 'upgrade']);

function isUnknownInteractionError(error: unknown): boolean {
  const candidate = error as { code?: unknown; rawError?: { code?: unknown }; message?: unknown } | undefined;
  return candidate?.code === 10062 || candidate?.rawError?.code === 10062 || /Unknown interaction/i.test(String(candidate?.message ?? ''));
}

async function safeReply(interaction: ChatInputCommandInteraction, options: InteractionReplyOptions): Promise<void> {
  try {
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(options);
    } else {
      await interaction.reply(options);
    }
  } catch (error) {
    if (isUnknownInteractionError(error)) {
      console.warn(`[Discord] Dropped response for expired interaction ${interaction.commandName}`);
      return;
    }
    throw error;
  }
}

async function handleCommandError(interaction: ChatInputCommandInteraction, error: unknown): Promise<void> {
  if (isUnknownInteractionError(error)) {
    console.warn(`[Discord] Interaction expired before ${interaction.commandName} could be acknowledged`);
    return;
  }
  console.error(error);
  await safeReply(interaction, { embeds: [errorEmbed('Request Failed', 'Something went wrong')], flags: MessageFlags.Ephemeral });
}

await initializeCurrencyRates();
// Backfill `query_name` for existing chases if missing.
backfillChaseQueryNames();

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
  startPoller(client);
  startDiscoveryDropScheduler(client);
});

client.on(Events.Error, (error) => {
  if (isUnknownInteractionError(error)) {
    console.warn('[Discord] Ignored expired interaction error emitted by client');
    return;
  }
  console.error('[Discord] Client error', error);
});

client.on(Events.InteractionCreate, async (interaction: Interaction) => {
  try {
    const scopedInteraction = 'user' in interaction ? productScopedInteraction(interaction as any) : interaction;
    if (await handleChaseAddAutocomplete(scopedInteraction)) return;
    if (await handleChaseEditAutocomplete(scopedInteraction)) return;
    if (await handleChaseRemoveAutocomplete(scopedInteraction)) return;
    if (await handleChaseRemoveButtons(scopedInteraction)) return;
    if (await handleChaseListPagination(scopedInteraction)) return;
    if (await handleAlertFeedback(scopedInteraction)) return;
    if (await handleAlertSourceButtons(scopedInteraction)) return;
    if (await handleDiscoveryDropOpen(scopedInteraction)) return;
    if (await handleDiscoveryDropPage(scopedInteraction)) return;
    if (await handleDiscoveryActionSelect(scopedInteraction)) return;
    if (await handleDiscoveryFeedbackUndo(scopedInteraction)) return;
    if (await handleDiscoveryFeedback(scopedInteraction)) return;
    if (await handleDiscoveryVaultAdd(scopedInteraction)) return;
    if (!interaction.isChatInputCommand()) return;

    const command = commandMap.get(interaction.commandName);
    if (!command) return;

    if (!interaction.guildId) {
      await safeReply(interaction, {
        embeds: [warningEmbed('Server Command Channel Required', 'Vaultr commands must be used in your server command channel')],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const setupCommandName = 'setup';
    const channelExemptCommands = new Set([setupCommandName, 'health']);
    if (!channelExemptCommands.has(interaction.commandName)) {
      const configuredChannelId = getGuildCommandChannel(interaction.guildId);
      if (!configuredChannelId) {
        await safeReply(interaction, {
          embeds: [warningEmbed('Setup Required', `An admin must run \`/${setupCommandName} channel\` first to set the Vaultr command channel`)],
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      if (interaction.channelId !== configuredChannelId) {
        await safeReply(interaction, {
          embeds: [warningEmbed('Wrong Channel', `Please use Vaultr commands in <#${configuredChannelId}>`)],
          flags: MessageFlags.Ephemeral
        });
        return;
      }
    }

    await command.execute(accountScopedCommands.has(interaction.commandName) ? scopedInteraction : interaction);
  } catch (error) {
    if (interaction.isChatInputCommand()) {
      await handleCommandError(interaction, error);
      return;
    }
    if (isUnknownInteractionError(error)) return;
    console.error(error);
  }
});

await client.login(token);
