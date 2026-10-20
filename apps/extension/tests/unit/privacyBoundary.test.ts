import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC_DIR = path.resolve(process.cwd(), 'src');

const ALLOWED_FETCH_FILES = new Set([
  path.join('background', 'ModelProvider.ts'),
  path.join('resume', 'extraction', 'resumeExtractionAgent.ts'),
]);

const FORBIDDEN_PATTERNS: Array<{ name: string; pattern: RegExp; allowlistedFile?: boolean }> = [
  { name: 'fetch', pattern: /\bfetch\s*\(/, allowlistedFile: true },
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
  it('网络出口 API 仅允许出现在用户主动开启的模型通道', () => {
    const violations: string[] = [];
    for (const file of collectSourceFiles(SRC_DIR)) {
      const relative = path.relative(SRC_DIR, file);
      const content = readFileSync(file, 'utf8');
      for (const { name, pattern, allowlistedFile } of FORBIDDEN_PATTERNS) {
        if (pattern.test(content)) {
          if (allowlistedFile === true && ALLOWED_FETCH_FILES.has(relative)) {
            continue;
          }
          violations.push(`${name}: ${relative}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
