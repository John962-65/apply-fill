import { describe, expect, it } from 'vitest';

import { buildFieldIdentity } from '@/identity';
import { distillScopedElements } from '@/perceptor/FieldDistiller';
import { FingerprintCache } from '@/router/FingerprintCache';
import { fingerprintInputFor } from '@/router/FingerprintCache';
import { MappingMemory } from '@/memory/MappingMemory';
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
    const initial = buildExecutionPlan(compiled, [], {
      instances: [instanceOf(containers[0] as HTMLElement, 'instance_01', 'resume.education.2')], host: 'localhost',
    });
    const candidate = mustFind(initial.cacheCandidates, (item) => item.template === 'education[{index}].school');
    cache.record(candidate.input, candidate.template);
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

describe('经历路径上下文与相对记忆', () => {
  function projectInstances(label = '职位'): ScopedInstanceInput[] {
    document.body.innerHTML = `<section><h2>项目经历</h2>
      <div id="a"><label>${label}<input name="role" /></label></div>
      <div id="b"><label>${label}<input name="role" /></label></div></section>`;
    return ['a', 'b'].map((id, index) => ({ sectionType: 'project', instanceId: `project-${index}`,
      resumeEntryId: `resume.project.${index + 1}`, reanchorStatus: 'MATCHED',
      distilled: distillScopedElements(document.getElementById(id)!, { sectionType: 'project', instanceId: `project-${index}` }) }));
  }

  function fingerprint(instance: ScopedInstanceInput) {
    const field = instance.distilled[0]!.field;
    return fingerprintInputFor('jobs.test', { ...field, fieldKey: buildFieldIdentity(field.descriptor).fieldKey });
  }

  it('项目中的职位取自己的角色，缓存中工作路径被失效并回退正确规则', () => {
    const instances = projectInstances();
    const cache = new FingerprintCache();
    cache.record(fingerprint(instances[0]!), 'work[{index}].role');
    const plan = buildExecutionPlan(compileResume(createSampleResumeFacts()), [], { instances, cache, host: 'jobs.test' });
    expect(plan.executable.map((item) => item.targetPath)).toEqual(['projects[0].role', 'projects[1].role']);
    expect(plan.executable.map((item) => item.expectedValue)).toEqual(['前端负责人', '核心开发']);
    expect(cache.size).toBe(0);
  });

  it('缓存中的其他具体经历索引不能覆盖绑定条目', () => {
    const instances = projectInstances();
    const cache = new FingerprintCache();
    cache.record(fingerprint(instances[1]!), 'projects[0].role');
    const plan = buildExecutionPlan(compileResume(createSampleResumeFacts()), [], { instances: [instances[1]!], cache, host: 'jobs.test' });
    expect(plan.executable[0]?.targetPath).toBe('projects[1].role');
    expect(plan.executable[0]?.expectedValue).toBe('核心开发');
    expect(cache.size).toBe(0);
  });

  it.each(['work[{index}].role', 'projects[2].role', 'basic.name'])('LLM 的 %s 与当前项目不一致时转人工', (path) => {
    const instances = projectInstances('责任范围');
    const key = buildFieldIdentity(instances[1]!.distilled[0]!.field.descriptor).fieldKey;
    const plan = buildExecutionPlan(compileResume(createSampleResumeFacts()), [], { instances: [instances[1]!],
      llmProposals: new Map([[key, { targetPathTemplate: path, confidence: 0.99 }]]) });
    expect(plan.executable).toHaveLength(0);
    expect(plan.mappings[0]?.reason).toBe('ROUTE_CONTEXT_MISMATCH');
    expect(plan.issues[0]?.fieldKey).toBe(key);
  });

  it('项目切面跟随绑定 ResumeEntryId，而不是 DOM 顺序', () => {
    const instances = projectInstances('责任范围');
    const key = buildFieldIdentity(instances[1]!.distilled[0]!.field.descriptor).fieldKey;
    const compiled = compileResume(createSampleResumeFacts());
    const plan = buildExecutionPlan(compiled, [], { instances: [instances[1]!],
      llmProposals: new Map([[key, { targetPathTemplate: 'projections.projects[{index}].one_liner', confidence: 0.99 }]]) });
    expect(plan.executable[0]?.targetPath).toBe('projections.projects[1].one_liner');
    expect(plan.executable[0]?.expectedValue).toBe(compiled.projections.projects?.[1]?.one_liner);
  });

  it('第二段项目学到的角色语义在重载与简历重排后仍按各自绑定条目解析', () => {
    const instances = projectInstances('责任范围');
    const memory = new MappingMemory();
    memory.recordUserChoice({ ...fingerprint(instances[1]!), boundEntryIndex: 1 }, 'projects[1].role');
    const restored = new MappingMemory();
    restored.loadFromJSON(JSON.parse(JSON.stringify(memory.toJSON())));
    const facts = createSampleResumeFacts();
    facts.projects?.reverse();
    const plan = buildExecutionPlan(compileResume(facts), [], { instances, memory: restored, host: 'jobs.test' });
    expect(plan.executable.map((item) => item.targetPath)).toEqual(['projects[2].role', 'projects[1].role']);
    expect(plan.executable.map((item) => item.expectedValue)).toEqual(['前端负责人', '核心开发']);
    expect(plan.mappings.every((item) => item.source === 'memory')).toBe(true);
  });
});
