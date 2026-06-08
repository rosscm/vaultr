import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vaultr-test-'));
process.env.DATABASE_PATH = path.join(testDataDir, 'vaultr.db');