import { describe, expect, it } from 'vitest';

import { buildFieldIdentity } from '@/identity';
import { distillScopedElements } from '@/perceptor/FieldDistiller';
import { FingerprintCache } from '@/router/FingerprintCache';
import { compileResume } from '@/resume/compiler/compile';
import { buildExecutionPlan } from '@/runtime/planner';
import type { ScopedInstanceInput } from '@/runtime/planner';
import { createSampleResumeFacts } from '@/shared/samples/sampleResume';

import { mustFind } from './helpers';

function setupEducationContainers(): HTMLElement[] {
  document.body.innerHTML = `
    <section id="education">
      <h2>教育经历</h2>
      <div class="list">
        <div class="item" id="edu-a">
          <label>学校名称<input name="school" /></label>
          <label>专业<input name="major" /></label>
        </div>
        <div class="item" id="edu-b">
          <label>学校名称<input name="school" /></label>
          <label>专业<input name="major" /></label>
        </div>
      </div>
    </section>`;
  return [document.getElementById('edu-a') as HTMLElement, document.getElementById('edu-b') as HTMLElement];
}

function instanceOf(container: HTMLElement, instanceId: string, resumeEntryId?: string): ScopedInstanceInput {
  const input: ScopedInstanceInput = {
    sectionType: 'education',
    instanceId,
    reanchorStatus: 'MATCHED',
    distilled: distillScopedElements(container, { sectionType: 'education', instanceId }),
  };
  if (resumeEntryId !== undefined) {
    input.resumeEntryId = resumeEntryId;
  }
  return input;
}

describe('buildExecutionPlan 实例隔离', () => {
  it('不同实例按各自简历条目填写且不串写', () => {
    const containers = setupEducationContainers();
    const compiled = compileResume(createSampleResumeFacts(), 42);
    const plan = buildExecutionPlan(compiled, [], {
      instances: [
        instanceOf(containers[1] as HTMLElement, 'instance_02', 'resume.education.2'),
        instanceOf(containers[0] as HTMLElement, 'instance_01', 'resume.education.1'),
      ],
    });

    const mapped = plan.mappings.filter((mapping) => mapping.status === 'MAPPED');
    expect(mapped).toHaveLength(4);
    const paths = mapped.map((mapping) => mapping.targetPath).sort();
    expect(paths).toEqual(['education[0].major', 'education[0].school', 'education[1].major', 'education[1].school']);

    const secondSchool = mustFind(mapped, (mapping) => mapping.targetPath === 'education[1].school');
    expect(secondSchool.expectedValue).toBe('示例理工大学');
    const firstSchool = mustFind(mapped, (mapping) => mapping.targetPath === 'education[0].school');
    expect(firstSchool.expectedValue).toBe('示例大学');
    expect(firstSchool.fieldKey).not.toBe(secondSchool.fieldKey);
  });

  it('歧义实例不生成可执行项并进入人工确认', () => {
    const containers = setupEducationContainers();
    const compiled = compileResume(createSampleResumeFacts(), 42);
    const ambiguous: ScopedInstanceInput = {
      sectionType: 'education',
      instanceId: 'instance_01',
      reanchorStatus: 'AMBIGUOUS',
      distilled: distillScopedElements(containers[0] as HTMLElement, {
        sectionType: 'education',
        instanceId: 'instance_01',
      }),
      reason: 'REANCHOR_AMBIGUOUS',
    };
    const plan = buildExecutionPlan(compiled, [], { instances: [ambiguous] });
    expect(plan.executable).toHaveLength(0);
    expect(plan.mappings.every((mapping) => mapping.status === 'AMBIGUOUS')).toBe(true);
    expect(plan.issues).toHaveLength(2);
    expect(mustFind(plan.issues, (issue) => issue.label === '学校名称').kind).toBe('AMBIGUOUS');
  });

  it('没有可用简历条目时标记 NO_RESUME_ENTRY', () => {
    const containers = setupEducationContainers();
    const compiled = compileResume(createSampleResumeFacts(), 42);
    const plan = buildExecutionPlan(compiled, [], { instances: [instanceOf(containers[0] as HTMLElement, 'instance_09')] });
    expect(plan.executable).toHaveLength(0);
    expect(plan.mappings.every((mapping) => mapping.reason === 'NO_RESUME_ENTRY')).toBe(true);
  });
});

describe('buildExecutionPlan 缓存与 LLM 路径', () => {
  it('缓存命中的字段使用缓存路径与来源', () => {
    const containers = setupEducationContainers();
    const compiled = compileResume(createSampleResumeFacts(), 42);
    const cache = new FingerprintCache();
    cache.record(
      { host: 'localhost', sectionType: 'education', normalizedLabel: '学校名称', controlKind: 'text' },
      'education[{index}].school',
    );
    const plan = buildExecutionPlan(compiled, [], {
      instances: [instanceOf(containers[0] as HTMLElement, 'instance_01', 'resume.education.2')],
      cache,
      host: 'localhost',
    });
    const school = mustFind(plan.mappings, (mapping) => mapping.signature.label === '学校名称');
    expect(school.source).toBe('cache');
    expect(school.targetPath).toBe('education[1].school');
    expect(school.expectedValue).toBe('示例理工大学');
  });

  it('缓存未命中时记录可缓存候选', () => {
    const containers = setupEducationContainers();
    const compiled = compileResume(createSampleResumeFacts(), 42);
    const plan = buildExecutionPlan(compiled, [], {
      instances: [instanceOf(containers[0] as HTMLElement, 'instance_01', 'resume.education.1')],
      cache: new FingerprintCache(),
      host: 'localhost',
    });
    const candidate = mustFind(plan.cacheCandidates, (item) => item.template === 'education[{index}].school');
    expect(candidate.input.host).toBe('localhost');
    expect(candidate.input.sectionType).toBe('education');
  });

  it('未知字段可由 LLM 提议路径填充', () => {
    const containers = setupEducationContainers();
    const container = containers[0] as HTMLElement;
    const label = document.createElement('label');
    label.textContent = '课题组名称';
    const input = document.createElement('input');
    input.name = 'groupName';
    label.appendChild(input);
    container.appendChild(label);

    const compiled = compileResume(createSampleResumeFacts(), 42);
    const distilled = distillScopedElements(container, { sectionType: 'education', instanceId: 'instance_01' });
    const groupField = mustFind(distilled, (item) => item.field.descriptor.normalizedLabel === '课题组名称');
    const fieldKey = buildFieldIdentity(groupField.field.descriptor).fieldKey;

    const plan = buildExecutionPlan(compiled, [], {
      instances: [
        {
          sectionType: 'education',
          instanceId: 'instance_01',
          resumeEntryId: 'resume.education.2',
          reanchorStatus: 'MATCHED',
          distilled,
        },
      ],
      llmProposals: new Map([[fieldKey, { targetPathTemplate: 'education[{index}].school', confidence: 0.9 }]]),
    });
    const mapped = mustFind(plan.mappings, (mapping) => mapping.signature.label === '课题组名称');
    expect(mapped.source).toBe('llm');
    expect(mapped.targetPath).toBe('education[1].school');
    expect(mapped.expectedValue).toBe('示例理工大学');
  });
});
