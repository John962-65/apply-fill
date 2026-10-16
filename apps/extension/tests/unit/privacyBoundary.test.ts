import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC_DIR = path.resolve(process.cwd(), 'src');

const FORBIDDEN_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'fetch', pattern: /\bfetch\s*\(/ },
  { name: 'XMLHttpRequest', pattern: /new\s+XMLHttpRequest/ },
  { name: 'sendBeacon', pattern: /navigator\.sendBeacon/ },
  { name: 'WebSocket', pattern: /new\s+WebSocket/ },
  { name: 'EventSource', pattern: /new\s+EventSource/ },
];

function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

describe('本地隐私边界', () => {
  it('扩展源码不包含任何网络出口 API', () => {
    const violations: string[] = [];
    for (const file of collectSourceFiles(SRC_DIR)) {
      const content = readFileSync(file, 'utf8');
      for (const { name, pattern } of FORBIDDEN_PATTERNS) {
        if (pattern.test(content)) {
          violations.push(`${name}: ${path.relative(SRC_DIR, file)}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
