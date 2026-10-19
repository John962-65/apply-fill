import { describe, expect, it } from 'vitest';

import { ESSAY_MAX_LENGTH, generateEssayDraft } from '@/jd/EssayGenerator';

const jd = {
  title: '高级前端工程师',
  company: '示例科技',
  responsibilities: '负责前端架构设计与组件库建设；优化页面性能',
  requirements: '5 年经验，精通 TypeScript；熟悉浏览器原理',
};

describe('generateEssayDraft', () => {
  it('结合 JD 与简历切面生成确定性草稿', () => {
    const draft = generateEssayDraft({
      jd,
      projection: { label: '项目经历「招聘推荐系统」', text: '负责候选人匹配引擎，覆盖百万级数据。' },
    });
    expect(draft).toContain('我应聘示例科技的“高级前端工程师”岗位。');
    expect(draft).toContain('项目经历「招聘推荐系统」：负责候选人匹配引擎，覆盖百万级数据。');
    expect(draft).toContain('岗位要求中提到“5 年经验，精通 TypeScript”');
    expect(draft).not.toContain('这与我的上述经历直接相关');
    expect(draft).toContain('期待有机会进一步交流');
    expect(draft).toBe(
      generateEssayDraft({
        jd,
        projection: { label: '项目经历「招聘推荐系统」', text: '负责候选人匹配引擎，覆盖百万级数据。' },
      }),
    );
  });

  it('缺少 JD 时使用问题文本开头', () => {
    const draft = generateEssayDraft({
      question: '自荐信',
      projection: { label: '简介摘要', text: '五年后端经验。' },
    });
    expect(draft).toContain('关于“自荐信”，结合我的经历说明如下。');
    expect(draft).toContain('简介摘要：五年后端经验。');
    expect(draft).not.toContain('岗位要求');
  });

  it('切面正文与整体长度均被截断', () => {
    const draft = generateEssayDraft({
      jd,
      projection: { label: '项目经历', text: 'x'.repeat(500) },
    });
    const bodyLine = draft.split('\n\n').find((part) => part.startsWith('项目经历：'));
    expect(bodyLine?.length).toBeLessThanOrEqual('项目经历：'.length + 320);
    expect(draft.length).toBeLessThanOrEqual(ESSAY_MAX_LENGTH);
  });

  it('要求句子截断到首个分句并限制长度', () => {
    const draft = generateEssayDraft({
      jd: { requirements: `${'甲'.repeat(50)}；第二句不应出现` },
      projection: { label: '简介摘要', text: '经验' },
    });
    expect(draft).toContain('岗位要求中提到');
    expect(draft).not.toContain('第二句不应出现');
    expect(draft).not.toContain('甲'.repeat(45));
  });
});
