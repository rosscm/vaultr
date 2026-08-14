import { Routes } from 'discord.js';

export type DiscordCommandScope = 'GUILD' | 'GLOBAL';

export type DiscordCommandRegistrationConfig = {
  token: string;
  clientId: string;
  scope: DiscordCommandScope;
  guildId?: string;
};

function envValue(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

export function resolveDiscordCommandRegistrationConfig(env: NodeJS.ProcessEnv): DiscordCommandRegistrationConfig {
  const token = envValue(env, 'DISCORD_TOKEN');
  const clientId = envValue(env, 'DISCORD_CLIENT_ID');
  const rawScope = (envValue(env, 'DISCORD_COMMAND_SCOPE') ?? 'GUILD').toUpperCase();

  if (!token || !clientId) {
    throw new Error('Missing DISCORD_TOKEN or DISCORD_CLIENT_ID in environment');
  }

  if (rawScope !== 'GUILD' && rawScope !== 'GLOBAL') {
    throw new Error('DISCORD_COMMAND_SCOPE must be GUILD or GLOBAL');
  }

  if (rawScope === 'GUILD') {
    const guildId = envValue(env, 'DISCORD_GUILD_ID');
    if (!guildId) {
      throw new Error('Missing DISCORD_GUILD_ID in environment for guild-scoped command registration');
    }

    return { token, clientId, scope: 'GUILD', guildId };
  }

  return { token, clientId, scope: 'GLOBAL' };
}

export function discordCommandRegistrationRoute(
  config: Pick<DiscordCommandRegistrationConfig, 'clientId' | 'scope' | 'guildId'>
): ReturnType<typeof Routes.applicationCommands> | ReturnType<typeof Routes.applicationGuildCommands> {
  return config.scope === 'GLOBAL'
    ? Routes.applicationCommands(config.clientId)
    : Routes.applicationGuildCommands(config.clientId, config.guildId!);
}

export function describeDiscordCommandRegistrationTarget(config: Pick<DiscordCommandRegistrationConfig, 'scope' | 'guildId'>): string {
  return config.scope === 'GLOBAL' ? 'global' : `guild ${config.guildId}`;
}
