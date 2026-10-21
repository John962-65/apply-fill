import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { CompiledResume, ResumeFactsDocument } from '../../../apps/extension/src/shared/contracts/resume';
import { launchExtensionContext, openWorkbench } from './helpers/extension';
import type { ExtensionSession } from './helpers/extension';
import { makePdfPages } from './helpers/pdf';

const PDF = makePdfPages([
  ['Name: ZhangSan', 'Phone: 13800001111', 'Education',
    'Example University | Bachelor | 2018.09 - 2022.06', 'Work Experience',
    'Example University | Engineer | 2023.07 - 2023.10', 'Projects',
    'Project Alpha | 2024.03 - 2024.09', 'Built a dashboard', 'Improved latency by 20%',
    'Project Beta | 2025.01 - 2025.06', 'Built a search service', 'Reduced cost by 30%'],
  ['Projects', 'Project Gamma | 2026.01 - 2026.06', 'Built a compiler', 'Improved throughput by 40%'],
]);

async function readCurrent(page: Page): Promise<CompiledResume> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('applyfill', 1);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<CompiledResume>((resolve, reject) => {
        const request = db.transaction('resumes', 'readonly').objectStore('resumes').get('current');
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
    } finally { db.close(); }
  });
}

async function parseWithMockModel(session: ExtensionSession, corrupt = false): Promise<Page> {
  let calls = 0;
  await session.context.route('**/stability-model/v1/chat/completions', async (route) => {
    calls++;
    const body = route.request().postDataJSON();
    const { sourceLines } = JSON.parse(body.messages[1].content) as {
      sourceLines: Array<{ lineId: string; page: number; text: string }>;
    };
    expect(new Set(sourceLines.map((line) => line.page))).toEqual(new Set([1, 2]));
    const field = (value: string, quote = value) => {
      const line = sourceLines.find((entry) => entry.text.includes(quote));
      if (!line) throw new Error(`Missing PDF fixture line: ${quote}`);
      return { value, quote, page: line.page, lineId: line.lineId };
    };
    const alphaDate = 'Project Alpha | 2024.03 - 2024.09';
    const betaDate = 'Project Beta | 2025.01 - 2025.06';
    const edu = 'Example University | Bachelor | 2018.09 - 2022.06';
    const work = 'Example University | Engineer | 2023.07 - 2023.10';
    const data = {
      basic: { name: field('ZhangSan', 'Name: ZhangSan'), phone: { ...field('13800001111', 'Phone: 13800001111'), ...(corrupt ? { page: 2 } : {}) } },
      education: [{ school: field('Example University', edu), degree: field('Bachelor', edu),
        startDate: corrupt ? field('2023-07', work) : field('2018-09', edu) }],
      work: [{ company: field('Example University', work), role: field('Engineer', work),
        startDate: corrupt ? field('2018-09', edu) : field('2023-07', work) }],
      projects: [
        { name: field('Project Alpha', alphaDate), description: field('Built a dashboard'),
          startDate: corrupt ? field('2025-01', betaDate) : field('2024-03', alphaDate),
          outcomes: field(corrupt ? 'Reduced cost by 30%' : 'Improved latency by 20%') },
        { name: field('Project Beta', betaDate), description: field('Built a search service'),
          outcomes: field(corrupt ? 'Improved throughput by 40%' : 'Reduced cost by 30%') },
        { name: field('Project Gamma', 'Project Gamma | 2026.01 - 2026.06'), outcomes: field('Improved throughput by 40%') },
      ], skills: [], warnings: [],
    };
    await route.fulfill({ json: { choices: [{ message: { content: JSON.stringify(data) } }] } });
  });
  const page = await openWorkbench(session.context, session.extensionId);
  await page.getByRole('link', { name: '配置 AI 解析服务' }).click();
  await page.getByTestId('resume-ai-mode').selectOption('cloud');
  await page.getByTestId('resume-ai-enabled').check();
  await page.getByTestId('resume-ai-baseurl').fill('http://localhost:5173/stability-model/v1');
  await page.getByTestId('resume-ai-model').fill('mock-stability-parser');
  await page.getByTestId('resume-ai-authorize').click();
  await expect(page.getByTestId('resume-ai-notice')).toContainText('配置已保存并授权');
  await page.setInputFiles('[data-testid="attachment-input"]', { name: 'two-pages.pdf', mimeType: 'application/pdf', buffer: PDF });
  await expect(page.getByTestId('upload-notice')).toContainText('已保存附件');
  await page.getByTestId('parse-with-ai').click();
  await expect(page.getByTestId('resume-ai-notice')).toContainText('AI 解析完成', { timeout: 20000 });
  expect(calls).toBe(1);
  return page;
}

test('旧版不完整资料只读恢复，补录后保存仍保留原始数据', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await openWorkbench(session.context, session.extensionId);
    await expect(page.getByTestId('resume-json')).toBeVisible();
    const fact = (value: string) => ({ value, source: 'resume-import', verified: true, updatedAt: 1 });
    const originalFacts = { schemaVersion: 1, updatedAt: 1, basic: { name: fact('') },
      education: [{ school: fact('Example University'), startDate: fact('') }], preferences: {}, legacyNotes: 'keep original notes' };
    const old = { compilerVersion: 1, schemaVersion: 1, compiledAt: 42, facts: originalFacts, normalized: { basic: { name: '' } } };
    await page.evaluate(async (value) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('applyfill', 1);
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction('resumes', 'readwrite'); tx.objectStore('resumes').put(value, 'current');
          tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
        });
      } finally { db.close(); }
    }, old);
    await page.reload();
    await expect(page.getByTestId('resume-migration-notice')).toContainText('原始数据已保留');
    await expect(page.getByTestId('review-input-basic.name')).toHaveValue('');
    await expect(page.getByTestId('review-status-education[0].degree')).toHaveText('需补充');
    expect(await readCurrent(page)).toEqual(old);
    await page.getByTestId('review-input-basic.name').fill('Recovered Name');
    await page.getByTestId('review-confirm-basic.name').click();
    await page.getByTestId('review-save').click();
    await expect(page.getByTestId('review-panel')).toContainText('审核结果已保存');
    await page.reload();
    await expect(page.getByTestId('review-input-basic.name')).toHaveValue('Recovered Name');
    const saved = await readCurrent(page);
    expect(saved.facts.migration?.originalFacts).toEqual(originalFacts);
    expect(saved.normalized.basic.name).toBe('Recovered Name');
    expect(saved.normalized.education[0]).toMatchObject({ school: '', degree: '' });
    expect(saved.normalized.education[0]?.startDate).toBeUndefined();
  } finally { await session.close(); }
});

test('模拟 API：多页 PDF 的教育、工作和项目不能互借日期及成果', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await parseWithMockModel(session, true);
    const facts = JSON.parse(await page.getByTestId('parse-json').inputValue()) as ResumeFactsDocument;
    expect(facts.basic.phone).toBeUndefined();
    expect(facts.education[0]?.startDate).toBeUndefined();
    expect(facts.work?.[0]?.startDate).toBeUndefined();
    expect(facts.projects?.[0]?.startDate).toBeUndefined();
    expect(facts.projects?.[0]?.outcomes).toBeUndefined();
    expect(facts.projects?.[1]?.outcomes).toBeUndefined();
    expect(facts.projects?.[0]?.description?.value).toBe('Built a dashboard');
    expect(facts.education[0]?.school.evidence?.[0]).toMatchObject({ page: 1, sectionKind: 'education' });
    expect(facts.work?.[0]?.company.evidence?.[0]).toMatchObject({ page: 1, sectionKind: 'work' });
    const gamma = facts.projects?.[2];
    expect(gamma?.outcomes?.evidence?.[0]).toMatchObject({ page: 2, sectionKind: 'projects', instanceId: gamma?.name.evidence?.[0]?.instanceId });
    expect(gamma?.name.evidence?.[0]?.instanceId).not.toBe(facts.projects?.[0]?.name.evidence?.[0]?.instanceId);
    await expect(page.getByTestId('resume-ai-warnings')).toContainText('已丢弃');
    await expect(page.getByTestId('review-input-projects[0].outcomes')).toHaveValue('');
    await page.getByTestId('review-confirm-basic.name').click();
    await page.getByTestId('review-confirm-group-projects-0').click();
    await page.getByTestId('review-save').click();
    await expect(page.getByTestId('review-panel')).toContainText('审核结果已保存');
    const saved = await readCurrent(page);
    expect(saved.normalized.projects?.[0]?.description).toBe('Built a dashboard');
    expect(saved.normalized.projects?.[0]?.outcomes).toBeUndefined();
    expect(saved.normalized.projects?.[0]?.startDate).toBeUndefined();
  } finally { await session.close(); }
});

test('模拟 API：编辑和清空提取值后保存，原始引用保留为历史记录', async () => {
  const session = await launchExtensionContext();
  try {
    const page = await parseWithMockModel(session);
    await page.getByTestId('review-confirm-basic.name').click();
    await page.getByTestId('review-confirm-group-projects-0').click();
    await page.getByTestId('review-input-projects[0].description').fill('Built a dashboard with manual corrections');
    await page.getByTestId('review-input-projects[0].startDate').fill('');
    await expect(page.getByTestId('review-status-projects[0].description')).toHaveText('待核对');
    await expect(page.getByTestId('review-status-projects[0].startDate')).toHaveText('已清空');
    await expect(page.getByTestId('review-modified-projects[0].description')).toContainText('不是当前值的证据');
    await expect(page.getByTestId('review-evidence-projects[0].startDate')).toContainText('Project Alpha | 2024.03');
    // Both save entrances must accept pending, empty dates as a draft.
    await page.getByTestId('parse-confirm').click();
    await expect(page.getByTestId('review-panel')).toContainText('审核结果已保存');
    await page.reload();
    await expect(page.getByTestId('review-input-projects[0].description')).toHaveValue('Built a dashboard with manual corrections');
    await expect(page.getByTestId('review-modified-projects[0].description')).toContainText('原提取值：Built a dashboard');
    let saved = await readCurrent(page);
    expect(saved.facts.projects?.[0]?.startDate).toMatchObject({ value: '', originalValue: '2024-03', valueModified: true, evidenceStatus: 'historical' });
    expect(saved.normalized.projects?.[0]?.description).toBeUndefined();
    await page.getByTestId('review-confirm-projects[0].description').click();
    await page.getByTestId('review-save').click();
    await expect(page.getByTestId('review-panel')).toContainText('审核结果已保存');
    saved = await readCurrent(page);
    expect(saved.normalized.projects?.[0]?.description).toBe('Built a dashboard with manual corrections');
    expect(saved.facts.projects?.[0]?.description).toMatchObject({ originalValue: 'Built a dashboard', evidenceStatus: 'historical', valueModified: true,
      evidence: [expect.objectContaining({ text: 'Built a dashboard', status: 'historical', sectionKind: 'projects' })] });
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出已编译 JSON' }).click();
    const download = await downloadPromise;
    const backup = readFileSync((await download.path())!, 'utf8');
    await page.getByTestId('resume-json').fill(backup);
    await page.getByTestId('import-resume').click();
    await expect(page.getByTestId('import-notice')).toContainText('导入并编译成功');
    saved = await readCurrent(page);
    expect(saved.facts.projects?.[0]?.startDate).toMatchObject({ value: '', originalValue: '2024-03', evidenceStatus: 'historical' });
    expect(saved.facts.projects?.[0]?.description?.evidence).toEqual(JSON.parse(backup).facts.projects[0].description.evidence);
    const invalid = JSON.parse(backup);
    Object.assign(invalid.facts.projects[0].startDate, { value: '2024-19', reviewStatus: 'confirmed', verified: true });
    await page.getByTestId('resume-json').fill(JSON.stringify(invalid));
    await page.getByTestId('import-resume').click();
    await expect(page.getByTestId('import-notice')).toContainText('日期无效');
    expect(await readCurrent(page)).toEqual(saved);
  } finally { await session.close(); }
});
