import fs from 'node:fs';
import path from 'node:path';

const outputPath = path.resolve(process.argv[2] ?? 'dist/build-info.json');
const gitPath = path.resolve('.git');
const gitDir = fs.statSync(gitPath).isDirectory()
  ? gitPath
  : path.resolve(path.dirname(gitPath), fs.readFileSync(gitPath, 'utf8').replace(/^gitdir:\s*/, '').trim());
const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
const revisionFromGit = head.startsWith('ref: ')
  ? fs.existsSync(path.join(gitDir, head.slice(5)))
    ? fs.readFileSync(path.join(gitDir, head.slice(5)), 'utf8').trim()
    : fs.readFileSync(path.join(gitDir, 'packed-refs'), 'utf8').split('\n').find((line) => line.endsWith(` ${head.slice(5)}`))?.split(' ')[0]
  : head;
const revision = (process.env.VAULTR_BUILD_REVISION ?? revisionFromGit ?? 'unknown').trim();
const builtAt = process.env.VAULTR_BUILD_AT ?? new Date().toISOString();

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify({ revision, builtAt }, null, 2)}\n`);
