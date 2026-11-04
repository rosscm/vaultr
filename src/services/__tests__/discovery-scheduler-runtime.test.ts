import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(process.cwd());

describe('standalone Display Case scheduler runtime', () => {
  it('runs without Discord and is not also started by the bot', () => {
    const scheduler = fs.readFileSync(path.join(root, 'src/discovery-scheduler.ts'), 'utf8');
    const bot = fs.readFileSync(path.join(root, 'src/index.ts'), 'utf8');
    const unit = fs.readFileSync(path.join(root, 'deploy/vaultr-discovery-scheduler.service'), 'utf8');

    expect(scheduler).toContain("logBuildInfo('discovery-scheduler')");
    expect(scheduler).toContain('startDiscoveryDropScheduler()');
    expect(scheduler).not.toContain('discord.js');
    expect(scheduler).not.toContain('DISCORD_TOKEN');
    expect(bot).not.toContain('startDiscoveryDropScheduler');
    expect(unit).toContain('dist/discovery-scheduler.js');
    expect(unit).toContain('VAULTR_ENVIRONMENT=production');
  });
});
