import {
  discordAvatarUrl,
  resolveOrCreateDiscordUser,
  type VaultrUserId
} from './accounts.js';

export type DiscordInteractionUser = {
  id: string;
  username?: string;
  globalName?: string | null;
  avatar?: string | null;
};

export function resolveVaultrUserIdForDiscordInteraction(interaction: { user: DiscordInteractionUser }): VaultrUserId {
  const discordUserId = interaction.user.id;
  const user = resolveOrCreateDiscordUser({
    discordUserId,
    username: interaction.user.username,
    displayName: interaction.user.globalName ?? interaction.user.username,
    avatarUrl: discordAvatarUrl(discordUserId, interaction.user.avatar ?? undefined)
  });
  return user.id;
}

export function productScopedInteraction<T extends { user: DiscordInteractionUser }>(
  interaction: T,
  vaultrUserId = resolveVaultrUserIdForDiscordInteraction(interaction)
): T {
  const userProxy = new Proxy(interaction.user, {
    get(target, property, receiver) {
      if (property === 'id') return vaultrUserId;
      return Reflect.get(target, property, receiver);
    }
  });

  return new Proxy(interaction, {
    get(target, property, receiver) {
      if (property === 'discordUserId') return interaction.user.id;
      if (property === 'user') return userProxy;
      return Reflect.get(target, property, receiver);
    }
  });
}
