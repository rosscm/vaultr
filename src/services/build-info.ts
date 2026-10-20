import fs from 'node:fs';
import path from 'node:path';

export type BuildInfo = { revision: string; builtAt: string };

export function readBuildInfo(filePath = process.env.VAULTR_BUILD_INFO_PATH ?? path.resolve('dist/build-info.json')): BuildInfo | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Partial<BuildInfo>;
    if (!parsed.revision?.trim() || !parsed.builtAt?.trim()) return undefined;
    return { revision: parsed.revision.trim(), builtAt: parsed.builtAt.trim() };
  } catch {
    return undefined;
  }
}

export function logBuildInfo(service: string): void {
  const info = readBuildInfo();
  console.info(`[Build] service=${service} revision=${info?.revision ?? 'unknown'} builtAt=${info?.builtAt ?? 'unknown'}`);
}
