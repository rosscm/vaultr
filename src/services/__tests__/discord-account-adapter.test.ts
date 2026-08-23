import { describe, expect, it } from 'vitest';
import { getIdentity } from '../accounts.js';
import { db } from '../db.js';
import {
  productScopedInteraction,
  resolveVaultrUserIdForDiscordInteraction
} from '../discord-account-adapter.js';

function cleanup(userId: string): void {
  db.prepare('DELETE FROM user_identities WHERE user_id = ? OR provider_user_id = ?').run(userId, userId);
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
}

describe('discord account adapter', () => {
  it('resolves Discord interaction users to internal Vaultr accounts', () => {
    const discordUserId = `discord-adapter-${Date.now()}`;
    cleanup(discordUserId);

    const interaction = {
      user: {
        id: discordUserId,
        username: 'collector',
        globalName: 'Collector',
        avatar: 'avatar-hash'
      }
    };

    const vaultrUserId = resolveVaultrUserIdForDiscordInteraction(interaction);
    expect(vaultrUserId).toMatch(/^usr_/);
    expect(getIdentity('DISCORD', discordUserId)).toMatchObject({
      userId: vaultrUserId,
      providerUserId: discordUserId
    });

    cleanup(discordUserId);
    cleanup(vaultrUserId);
  });

  it('scopes product handlers to Vaultr IDs while preserving the Discord ID separately', () => {
    const discordUserId = `discord-scoped-${Date.now()}`;
    cleanup(discordUserId);

    const interaction = {
      user: {
        id: discordUserId,
        username: 'collector',
        globalName: 'Collector',
        avatar: null
      }
    };

    const scoped = productScopedInteraction(interaction);
    expect(scoped.user.id).toMatch(/^usr_/);
    expect(scoped.user.id).not.toBe(discordUserId);
    expect((scoped as typeof scoped & { discordUserId: string }).discordUserId).toBe(discordUserId);

    cleanup(discordUserId);
    cleanup(scoped.user.id);
  });
});
