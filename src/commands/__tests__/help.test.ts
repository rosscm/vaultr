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
    expect(text).toContain('First time here? Get going with `/start`. 👋');
    expect(text).toContain('**/start**');
    expect(text).toContain('Opens the first-run guide for getting your Vault set up');
    expect(text).toContain('**/chase**');
    expect(text).toContain('Use `add`, `list`, `edit`, and `remove` to keep the Vault focused');
    expect(text).toContain('Better chase names include the card number, set, or variant when you know it');
    expect(text).toContain('**/alerts**');
    expect(text).toContain('Use `settings` for confidence, currency, volume, shipping, and sources');
    expect(text).toContain('Use `status`, `recent`, and `preview` to inspect what Vaultr is watching and sending');
    expect(text).toContain('Dial up confidence for fewer, cleaner alerts');
    expect(text).toContain('Dial down confidence for more possible finds, with more noise');
    expect(text).toContain('**/plan**');
    expect(text).toContain('Shows your current Free Vault or Full Vault access');
    expect(text).not.toContain('Server admins can use `set`');
    expect(text).toContain('**/upgrade**');
    expect(text).toContain('Explains what Vaultr Pro opens inside the Full Vault');
    expect(text).toContain('**/feed**');
    expect(text).toContain('Admin: turn Community Vault Pulse posts on or off');
    expect(text).toContain('**/setup**');
    expect(text).toContain('Admin: choose the server’s Vaultr channel');
    expect(text).not.toContain('**/health**');
    expect(text).not.toContain('Owner: inspect runtime health');
    expect(text).toContain('**/help**');
    expect(text).toContain('Shows this command guide when you need the full map again');
    expect(text).not.toContain('promo stamp');
    expect(text).not.toContain('**When It Feels Quiet**');
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