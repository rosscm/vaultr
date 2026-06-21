import { describe, expect, it, vi } from 'vitest';
import { help } from '../help.js';

describe('help command', () => {
  it('acts as a command guide instead of a second quick start', async () => {
    const reply = vi.fn(async (_payload: any) => undefined);

    await help.execute({ reply });

    const payload = reply.mock.calls[0]?.[0];
    const data = payload.embeds[0].toJSON();
    const text = [data.title, data.description, data.footer?.text].join('\n');

    expect(help.data.toJSON().description).toBe('Show the Vaultr command guide');
    expect(data.title).toBe('🧭 Vaultr Command Guide');
    expect(text).toContain('Use this as your Vault map');
    expect(text).toContain('First time here? Start with `/start` and one specific card chase.');
    expect(text).toContain('**Start Watching**');
    expect(text).toContain('`/start` opens the first-run guide');
    expect(text).toContain('`/chase add` adds a card for Vaultr to watch');
    expect(text).toContain('Strong chase names include the card number, set, language, or variant when you know it');
    expect(text).toContain('**Refine The Vault**');
    expect(text).toContain('`/chase edit` tightens a chase name');
    expect(text).toContain('**Tune Alerts**');
    expect(text).toContain('`/alerts settings` controls confidence, currency, volume, shipping, and sources');
    expect(text).toContain('`/alerts preview` checks how a listing would read before it sends');
    expect(text).toContain('Dial up confidence for fewer, cleaner alerts');
    expect(text).toContain('Dial down confidence for more possible finds, with more noise');
    expect(text).toContain('**Discover More**');
    expect(text).toContain('Weekly Shelf arrives in the setup channel when the weekly drop is live');
    expect(text).not.toContain('`/discover`');
    expect(text).toContain('`/plan` shows current Free Vault or Full Vault access');
    expect(text).not.toContain('Server admins can use `set`');
    expect(text).toContain('**Server Rhythm**');
    expect(text).toContain('`/setup channel` lets admins choose where Vaultr posts server moments');
    expect(text).toContain('`/feed` lets admins turn Community Vault Pulse posts on or off');
    expect(text).toContain('**When It Feels Quiet**');
    expect(text).toContain('Quiet days are normal. Vaultr sends chase alerts only when a listing clears your match settings');
    expect(text).not.toContain('**/health**');
    expect(text).not.toContain('Owner: inspect runtime health');
    expect(text).not.toContain('promo stamp');
    expect(text).not.toContain('**When It Feels Noisy**');
    expect(text).not.toContain('For first-time setup, run `/start`.');
    expect(text).not.toContain('**Alert Confidence**');
    expect(text).not.toContain('**Command Map**');
    expect(text).not.toContain('**Free Vault vs Full Vault**');
    expect(text).not.toContain('Vaultr Quick Start');
    expect(text).not.toContain('**First Steps**');
    expect(text).not.toContain('Start with one specific chase');
  });
});