import { describe, expect, it } from 'vitest';

import { privateFactStrings, sanitizeRoutingFields, sanitizeRoutingLabel } from '@/router/MetadataPrivacy';
import { LLMGateway } from '@/background/LLMGateway';
import { DEFAULT_LLM_CONFIG, LLM_CONFIG_STORAGE_KEY } from '@/shared/contracts/llm';
import { compileResume } from '@/resume/compiler';
import { createSampleResumeFacts } from '@/shared/samples/sampleResume';

describe('LLM metadata privacy', () => {
  it('删除已知简历事实与未知网页中的邮箱、电话和身份证号', () => {
    const compiled = compileResume(createSampleResumeFacts());
    const privateValues = privateFactStrings(compiled);
    const label = sanitizeRoutingLabel('张三 联系电话 +86 138-0000-1111 邮件 stranger@example.com 证件 110101199001011234', privateValues);
    for (const value of ['张三', '138-0000-1111', 'stranger@example.com', '110101199001011234']) expect(label).not.toContain(value);
    expect(label).toContain('联系电话');
  });

  it('长正文或简历正文片段不作为字段标签发往模型', () => {
    expect(sanitizeRoutingLabel('甲'.repeat(81))).toBe('');
    expect(sanitizeRoutingLabel('表单字段包含私密项目描述的连续片段', ['本人的超长事实正文'.repeat(10) + '表单字段包含私密项目描述的连续片段'])).toBe('');
  });

  it('传输使用临时字段别名，原始字段键留在本地', () => {
    const result = sanitizeRoutingFields([{ fieldKey: 'person@example.com', label: '就读机构', controlKind: 'text', sectionType: 'education' }], []);
    expect(JSON.stringify(result.fields)).not.toContain('person@example.com');
    expect(result.originalKeys.get('route_0')).toBe('person@example.com');
  });

  it('标签中的空白排版变化不能绕过已知个人事实清洗', () => {
    const label = sanitizeRoutingLabel('张 三 联系人 John Doe', ['张三', 'JohnDoe']);
    expect(label).not.toContain('张');
    expect(label).not.toContain('John');
  });

  it('唯一网络出口的实际请求体完成本地脱敏，返回路径恢复原始键', async () => {
    const compiled = compileResume(createSampleResumeFacts());
    const config = { ...DEFAULT_LLM_CONFIG, enabled: true, baseUrl: 'https://model.example/v1', model: 'test' };
    let body = '';
    const gateway = new LLMGateway({ loadResume: async () => compiled,
      storageArea: { get: async () => ({ [LLM_CONFIG_STORAGE_KEY]: config }) } as unknown as chrome.storage.StorageArea,
      fetchFn: async (_url, init) => {
        body = String(init.body);
        return new Response(JSON.stringify({ choices: [{ message: { content: '{"mappings":[{"fieldKey":"route_0","targetPath":"basic.phone","confidence":0.9}]}' } }] }));
      },
    });
    const result = await gateway.routeFields([{ fieldKey: 'zhangsan@example.com', label: '张三的联系电话 13800001111', controlKind: 'text', sectionType: 'basic' }]);
    expect(result.proposals?.[0]?.fieldKey).toBe('zhangsan@example.com');
    for (const value of ['张三', '13800001111', 'zhangsan@example.com']) expect(body).not.toContain(value);
  });

  it('无法完成本地审查时不发送请求', async () => {
    let requests = 0;
    const gateway = new LLMGateway({ loadResume: async () => { throw new Error('DB unavailable'); },
      storageArea: { get: async () => ({ [LLM_CONFIG_STORAGE_KEY]: { ...DEFAULT_LLM_CONFIG, enabled: true, baseUrl: 'https://model.example/v1', model: 'test' } }) } as unknown as chrome.storage.StorageArea,
      fetchFn: async () => { requests += 1; return new Response('{}'); },
    });
    expect((await gateway.routeFields([{ fieldKey: 'one', label: '未知字段', controlKind: 'text', sectionType: 'basic' }])).error).toBe('PRIVACY_REVIEW_UNAVAILABLE');
    expect(requests).toBe(0);
  });
});
