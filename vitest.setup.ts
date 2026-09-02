import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vaultr-test-'));
process.env.DATABASE_PATH = path.join(testDataDir, 'vaultr.db');
process.env.CARD_CATALOG_PATH ??= path.join(testDataDir, 'card-catalog.db');

const originalConsoleInfo = console.info.bind(console);
const originalConsoleWarn = console.warn.bind(console);

function isNoisyDiscoveryShelfLog(args: unknown[]): boolean {
  return typeof args[0] === 'string' && args[0].startsWith('[DiscoveryShelf]');
}

console.info = (...args: unknown[]) => {
  if (isNoisyDiscoveryShelfLog(args)) return;
  originalConsoleInfo(...args);
};

console.warn = (...args: unknown[]) => {
  if (isNoisyDiscoveryShelfLog(args)) return;
  originalConsoleWarn(...args);
};
