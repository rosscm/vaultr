import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const source = resolve('web/assets/illustrations/collector-binder.svg');
const destination = resolve('docs/assets/illustrations/collector-binder.svg');

mkdirSync(dirname(destination), { recursive: true });
copyFileSync(source, destination);
console.log('Synced collector-binder.svg to the public site.');
