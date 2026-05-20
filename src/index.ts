import 'dotenv/config';
import { Client, Events, GatewayIntentBits, MessageFlags } from 'discord.js';
import { commands } from './commands/index.js';
import { addIgnoredListingFingerprint, getGuildCommandChannel, getSentAlertByKey } from './services/chase-store.js';
import { makeListingFingerprint } from './services/listing-fingerprint.js';
import { startPoller } from './services/poller.js';

const token = process.env.DISCORD_TOKEN;

if (!token) {
  throw new Error('Missing DISCORD_TOKEN in environment');
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const commandMap = new Map(commands.map((c) => [c.data.name, c]));

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
  startPoller(client);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isButton()) {
    if (!interaction.customId.startsWith('not_rel|')) return;
    const [, chaseId, listingId] = interaction.customId.split('|');
    if (!chaseId || !listingId) {
      await interaction.reply({ content: 'Could not parse feedback action.', flags: MessageFlags.Ephemeral });
      return;
    }

    const alert = getSentAlertByKey(interaction.user.id, chaseId, listingId, 'EBAY');
    if (!alert || !alert.listingTitle) {
      await interaction.reply({ content: 'Could not find the alert record for this listing.', flags: MessageFlags.Ephemeral });
      return;
    }

    const fingerprint = makeListingFingerprint(alert.listingTitle);
    if (!fingerprint) {
      await interaction.reply({ content: 'Could not derive listing fingerprint for feedback.', flags: MessageFlags.Ephemeral });
      return;
    }

    addIgnoredListingFingerprint(interaction.user.id, chaseId, fingerprint);
    await interaction.reply({
      content: 'Saved. Similar listings for this chase will be suppressed going forward.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const command = commandMap.get(interaction.commandName);
  if (!command) return;

  if (!interaction.guildId) {
    await interaction.reply({
      content: 'Vaultr commands must be used in your server command channel.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const setupCommandName = 'setup-channel-set';
  if (interaction.commandName !== setupCommandName) {
    const configuredChannelId = getGuildCommandChannel(interaction.guildId);
    if (!configuredChannelId) {
      await interaction.reply({
        content: `An admin must run \`/${setupCommandName}\` first to set the Vaultr command channel.`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (interaction.channelId !== configuredChannelId) {
      await interaction.reply({
        content: `Please use Vaultr commands in <#${configuredChannelId}>.`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }
  }

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(error);
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: 'Something went wrong.', flags: MessageFlags.Ephemeral });
    } else {
      await interaction.reply({ content: 'Something went wrong.', flags: MessageFlags.Ephemeral });
    }
  }
});

await client.login(token);
