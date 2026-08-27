import fs from 'node:fs';
import path from 'node:path';

export function* jsonFiles(root: string): Generator<string> {
  const stack = [path.resolve(root)];
  while (stack.length > 0) {
    const current = stack.pop()!;
    const stat = fs.statSync(current);
    if (stat.isDirectory()) {
      const entries = fs.readdirSync(current, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === '.git' || entry.name === 'node_modules') continue;
        stack.push(path.join(current, entry.name));
      }
      continue;
    }
    if (current.endsWith('.json')) yield current;
  }
}

export function readJsonFile(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
}

export function asRecord(value: unknown): Record<string, any> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : undefined;
}

export function arrayFromJson(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const record = asRecord(value);
  if (!record) return [];
  if (Array.isArray(record.cards)) return record.cards;
  if (Array.isArray(record.data)) return record.data;
  return [];
}
