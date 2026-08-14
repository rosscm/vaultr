import { describe, expect, it } from 'vitest';
import {
  describeDiscordCommandRegistrationTarget,
  discordCommandRegistrationRoute,
  resolveDiscordCommandRegistrationConfig
} from '../discord-command-registration.js';

describe('discord command registration config', () => {
  it('defaults to guild scope and requires a guild id', () => {
    const config = resolveDiscordCommandRegistrationConfig({
      DISCORD_TOKEN: 'token',
      DISCORD_CLIENT_ID: 'client',
      DISCORD_GUILD_ID: 'guild'
    });

    expect(config).toEqual({
      token: 'token',
      clientId: 'client',
      scope: 'GUILD',
      guildId: 'guild'
    });
  });

  it('supports explicit global scope without a guild id', () => {
    const config = resolveDiscordCommandRegistrationConfig({
      DISCORD_TOKEN: 'token',
      DISCORD_CLIENT_ID: 'client',
      DISCORD_COMMAND_SCOPE: 'GLOBAL'
    });

    expect(config).toEqual({
      token: 'token',
      clientId: 'client',
      scope: 'GLOBAL'
    });
    expect(describeDiscordCommandRegistrationTarget(config)).toBe('global');
    expect(discordCommandRegistrationRoute(config)).toContain('/applications/client/commands');
  });

  it('builds the guild-scoped Discord route when requested', () => {
    const config = resolveDiscordCommandRegistrationConfig({
      DISCORD_TOKEN: 'token',
      DISCORD_CLIENT_ID: 'client',
      DISCORD_COMMAND_SCOPE: 'GUILD',
      DISCORD_GUILD_ID: 'guild'
    });

    expect(describeDiscordCommandRegistrationTarget(config)).toBe('guild guild');
    expect(discordCommandRegistrationRoute(config)).toContain('/applications/client/guilds/guild/commands');
  });

  it('rejects invalid scope values', () => {
    expect(() => resolveDiscordCommandRegistrationConfig({
      DISCORD_TOKEN: 'token',
      DISCORD_CLIENT_ID: 'client',
      DISCORD_COMMAND_SCOPE: 'BETA'
    })).toThrow('DISCORD_COMMAND_SCOPE must be GUILD or GLOBAL');
  });

  it('rejects guild scope without a guild id', () => {
    expect(() => resolveDiscordCommandRegistrationConfig({
      DISCORD_TOKEN: 'token',
      DISCORD_CLIENT_ID: 'client',
      DISCORD_COMMAND_SCOPE: 'GUILD'
    })).toThrow('Missing DISCORD_GUILD_ID in environment for guild-scoped command registration');
  });
});
