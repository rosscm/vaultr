import { PermissionFlagsBits } from 'discord.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setupChannelSet } from '../setup-channel-set.js';
import { db } from '../../services/db.js';
import { getGuildCommandChannel, setGuildCommunityFeedMode } from '../../services/chase-store.js';

const deleteGuildAlertChannelStmt = db.prepare('DELETE FROM guild_alert_channels WHERE guild_id = ?');
const deleteGuildCommunityFeedStmt = db.prepare('DELETE FROM guild_community_feed WHERE guild_id = ?');
const touchedGuildIds = new Set<string>();

function testGuildId(label: string): string {
  const guildId = `setup-${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  touchedGuildIds.add(guildId);
  return guildId;
}

function mockSetupInteraction(guildId: string, grantedPermissions: bigint[]) {
  const reply = vi.fn(async (_payload?: any) => undefined);
  const permissionSet = new Set(grantedPermissions);
  const channel = {
    id: `channel-${guildId}`,
    permissionsFor: vi.fn(() => ({
      has: (permission: bigint) => permissionSet.has(permission)
    }))
  };

  return {
    guildId,
    guild: {
      members: {
        me: { id: `bot-${guildId}` }
      }
    },
    client: { user: { id: `bot-${guildId}` } },
    memberPermissions: { has: () => true },
    options: {
      getChannel: () => channel
    },
    reply,
    channel
  };
}

afterEach(() => {
  for (const guildId of touchedGuildIds) {
    deleteGuildAlertChannelStmt.run(guildId);
    deleteGuildCommunityFeedStmt.run(guildId);
  }
  touchedGuildIds.clear();
});

describe('setup channel command', () => {
  it('persists the channel when Vaultr has the required permissions', async () => {
    const guildId = testGuildId('success');
    const interaction = mockSetupInteraction(guildId, [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.EmbedLinks
    ]);

    await setupChannelSet.execute(interaction);

    expect(getGuildCommandChannel(guildId)).toBe(interaction.channel.id);
    const payload = interaction.reply.mock.calls[0]?.[0];
    const description = payload.embeds[0].toJSON().description ?? '';
    expect(description).toContain(`**Channel:** <#${interaction.channel.id}>`);
    expect(description).toContain('Community Vault Pulse: On');
  });

  it('shows the current stored Vault Pulse mode in setup confirmation', async () => {
    const guildId = testGuildId('feed-off');
    setGuildCommunityFeedMode(guildId, 'OFF');
    const interaction = mockSetupInteraction(guildId, [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.EmbedLinks
    ]);

    await setupChannelSet.execute(interaction);

    const description = interaction.reply.mock.calls[0]?.[0].embeds[0].toJSON().description ?? '';
    expect(description).toContain('Community Vault Pulse: Off');
  });

  it.each([
    ['View Channel', [PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks]],
    ['Send Messages', [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.EmbedLinks]],
    ['Embed Links', [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]]
  ])('does not persist the channel when %s is missing', async (permissionName, grantedPermissions) => {
    const guildId = testGuildId(`missing-${permissionName.replace(/\s+/g, '-').toLowerCase()}`);
    const interaction = mockSetupInteraction(guildId, grantedPermissions);

    await setupChannelSet.execute(interaction);

    expect(getGuildCommandChannel(guildId)).toBeNull();
    const description = interaction.reply.mock.calls[0]?.[0].embeds[0].toJSON().description ?? '';
    expect(description).toContain(`**Missing:** ${permissionName}`);
  });
});
