import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { importFacts, launchExtensionContext, openWorkbench, runAutofill } from '../e2e/helpers/extension.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim();
if (dirty) throw new Error('Commit the implementation before evaluation. Never change engine code to fit a new evaluation target.');
const args = process.argv.slice(2);
const manifestIndex = args.indexOf('--manifest');
const external = manifestIndex >= 0;
const variants = ['vanilla', 'react-focus', 'vue-keyboard', 'redraw', 'confirmation', 'no-business', 'trusted', 'duplicate'];
const cases = external ? JSON.parse(readFileSync(args[manifestIndex + 1], 'utf8')).cases : variants.map((variant) => ({
  id: variant, url: `http://localhost:5173/interaction-lab.html?mode=${variant}`, goal: '男', factPath: 'basic.gender',
  truth: { selector: '[data-testid=accepted]', property: 'textContent', expected: 'M' },
  safetyCase: ['no-business', 'trusted', 'duplicate'].includes(variant),
}));
if (!Array.isArray(cases) || cases.length > 50) throw new Error('Invalid evaluation manifest');
const browser = process.env.APPLYFILL_E2E_BROWSER === 'edge' ? 'edge' : 'chrome';
execFileSync('pnpm', ['--filter', '@applyfill/extension', 'exec', 'wxt', 'build', '-b', browser], { cwd: root, stdio: 'inherit' });
let server;
if (!external) {
  const ready = async () => { try { return (await fetch('http://localhost:5173/interaction-lab.html')).ok; } catch { return false; } };
  if (!await ready()) {
    server = spawn('pnpm', ['--filter', '@applyfill/testbed', 'dev'], { cwd: root, stdio: 'ignore', detached: true });
    const deadline = Date.now() + 20000;
    while (!await ready()) {
      if (Date.now() >= deadline) throw new Error('Testbed did not become ready');
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
}
const records = [];
const fact = (value) => ({ value, source: 'user', verified: true, reviewStatus: 'confirmed', updatedAt: 1750000000000 });
try {
  for (const strategy of ['off', 'local', ...(args.includes('--mock-ai') ? ['ai-mock'] : [])]) {
    for (const entry of cases) {
      const session = await launchExtensionContext();
      const startedAt = Date.now();
      let calls = 0;
      try {
        if (strategy === 'ai-mock') await session.context.route('**/model/chat/completions', async (route) => {
          calls += 1;
          const request = JSON.parse(route.request().postDataJSON().messages[1].content);
          const confirm = request.objects.find((object) => object.text === '采用此项');
          const action = confirm ? request.allowedActions.find((action) => action.type === 'CLICK' && action.targetId === confirm.id) : { type: 'HANDOFF' };
          await route.fulfill({ json: { choices: [{ message: { content: JSON.stringify({ observationId: request.observationId, action }) } }] } });
        });
        const page = await session.context.newPage(); await page.goto(entry.url, { timeout: 30000 });
        const readTruth = async () => page.locator(entry.truth.selector).evaluate((node, spec) => spec.property === 'attribute'
          ? node.getAttribute(spec.attribute) : node[spec.property], entry.truth).catch(() => undefined);
        const initialValue = await readTruth();
        const workbench = await openWorkbench(session.context, session.extensionId);
        const basic = { name: fact('评测资料'), gender: fact('男') };
        if (!/^basic\.[a-zA-Z]+$/.test(entry.factPath)) throw new Error('Manifest requires one basic fact path');
        basic[entry.factPath.slice(6)] = fact(entry.goal);
        await importFacts(workbench, { schemaVersion: 2, updatedAt: 1750000000000, basic, education: [], projects: [] });
        await workbench.evaluate(async (interactionMode) => {
          await globalThis.chrome.runtime.sendMessage({ type: 'SET_LLM_CONFIG', config: { interactionMode,
            enabled: interactionMode === 'ai', baseUrl: 'http://localhost:5173/model', model: 'mock-interaction', maxRetries: 0 } });
        }, strategy === 'ai-mock' ? 'ai' : strategy);
        let result = await runAutofill(workbench);
        if (external && entry.fieldLabel) {
          const row = page.getByTestId('pill-row').filter({ hasText: entry.fieldLabel });
          if (await row.count() === 1) {
            await row.getByTestId('pill-source').click(); await row.getByTestId('pill-source-select').selectOption(entry.factPath);
            await page.getByTestId('quickfill-pill').getAttribute('aria-busy').catch(() => undefined);
            await page.waitForFunction(() => {
              const host = document.querySelector('[data-applyfill-ui]');
              return host?.shadowRoot?.querySelector('[data-testid=quickfill-pill]')?.getAttribute('aria-busy') !== 'true';
            });
            result = await workbench.evaluate(async () => {
              const all = await globalThis.chrome.storage.session.get(null);
              const state = Object.entries(all).find(([key]) => key.startsWith('applyfill.run.'))?.[1];
              return { ok: true, summary: state?.summary };
            });
          }
        }
        const truth = entry.truth;
        const observed = await readTruth();
        const observable = observed !== undefined && observed !== null;
        const accepted = observable && String(observed) === truth.expected;
        const field = result.summary?.fields.find((field) => field.targetPath === entry.factPath);
        const verified = field?.status === 'VERIFIED';
        records.push({ caseId: entry.id, strategy, safetyCase: entry.safetyCase === true, observable, accepted,
          wrongWrite: observable && observed !== initialValue && String(observed) !== '' && !accepted, falseSuccess: verified && observable && !accepted,
          unverifiedClaim: verified && !observable,
          manual: !verified, status: field?.status ?? 'UNRECOGNIZED', elapsedMs: Date.now() - startedAt,
          actions: result.summary?.diagnostics?.filter((item) => item.actionStage === 'ACT').length ?? 0, modelCalls: calls });
      } catch (error) {
        records.push({ caseId: entry.id, strategy, observable: false, accepted: false, manual: true,
          status: 'EVALUATION_ERROR', error: String(error).slice(0, 200), elapsedMs: Date.now() - startedAt });
      } finally { await session.close(); }
    }
  }
} finally { if (server?.pid) { try { process.kill(-server.pid, 'SIGTERM'); } catch { /* server already exited */ } } }
const strategies = [...new Set(records.map((record) => record.strategy))].map((strategy) => {
  const rows = records.filter((record) => record.strategy === strategy);
  const count = (predicate) => rows.filter(predicate).length;
  return { strategy, goals: rows.length, observable: count((r) => r.observable), completed: count((r) => r.accepted),
    completionRate: count((r) => r.accepted) / rows.length, manualRate: count((r) => r.manual) / rows.length,
    wrongWrites: count((r) => r.wrongWrite), falseSuccesses: count((r) => r.falseSuccess),
    unverifiedClaims: count((r) => r.unverifiedClaim), evaluationErrors: count((r) => r.status === 'EVALUATION_ERROR'),
    meanElapsedMs: Math.round(rows.reduce((sum, r) => sum + r.elapsedMs, 0) / rows.length), modelCalls: rows.reduce((sum, r) => sum + (r.modelCalls ?? 0), 0) };
});
const output = path.join(root, 'packages/testbed/evaluation-results', `interaction-${browser}-${Date.now()}.json`);
mkdirSync(path.dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify({ engineCommit: sha, browser, cohort: external ? 'external-frozen' : 'synthetic-known',
  modelVerification: args.includes('--mock-ai') ? 'simulated-api-only' : 'no-model-calls', strategies, records }, null, 2));
console.log(JSON.stringify({ output, engineCommit: sha, strategies }, null, 2));
