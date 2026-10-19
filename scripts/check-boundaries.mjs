import assert from 'node:assert/strict';
import { ESLint } from 'eslint';

const eslint = new ESLint();
const checks = [
  ['shared', '@/router/FastRuleMatcher'],
  ['guard', '@/router/FastRuleMatcher'],
  ['perceptor', '@/actuator/Primitives'],
  ['perceptor', '../actuator/Primitives'],
  ['identity', '@/scheduler/WaveScheduler'],
  ['router', '../actuator/Primitives'],
  ['scheduler', '@/actuator/FieldExecutionEngine'],
  ['runtime', '@/ui/QuickFillPill'],
];

for (const [module, imported] of checks) {
  const results = await eslint.lintText(`import * as forbidden from '${imported}';\nvoid forbidden;\n`, {
    filePath: `apps/extension/src/${module}/__boundary_probe.ts`,
  });
  assert(results.some((result) => result.messages.some((message) => message.ruleId === 'import-x/no-restricted-paths')),
    `module boundary was bypassed: ${module} -> ${imported}`);
}
console.log(`Module boundaries: ${checks.length} forbidden imports rejected (including aliases and relative paths).`);
