import { describe, expect, it } from 'vitest';

import { sniffJobDescription } from '@/jd/JDSniffer';

function withJsonLd(payload: unknown, extra = ''): void {
  document.head.innerHTML = '';
  const script = document.createElement('script');
  script.type = 'application/ld+json';
  script.textContent = JSON.stringify(payload);
  document.head.appendChild(script);
  document.body.innerHTML = extra;
}

describe('sniffJobDescription', () => {
  it('从 JSON-LD JobPosting 提取岗位信息并拆分职责与要求', () => {
    withJsonLd({
      '@type': 'JobPosting',
      title: '高级前端工程师',
      hiringOrganization: { '@type': 'Organization', name: '示例科技' },
      jobLocation: { address: { addressLocality: '杭州', addressRegion: '浙江', addressCountry: 'CN' } },
      description:
        '<p>我们正在招聘前端工程师。</p><p>岗位职责：负责前端架构与组件库建设；</p><p>任职要求：5 年经验，精通 TypeScript。</p>',
    });
    const context = sniffJobDescription(document);
    expect(context?.title).toBe('高级前端工程师');
    expect(context?.company).toBe('示例科技');
    expect(context?.location).toBe('杭州 浙江 CN');
    expect(context?.source).toBe('jsonld');
    expect(context?.confidence).toBe('high');
    expect(context?.description).toContain('负责前端架构');
    expect(context?.responsibilities).toContain('负责前端架构与组件库建设');
    expect(context?.responsibilities).not.toContain('5 年经验');
    expect(context?.requirements).toContain('5 年经验，精通 TypeScript');
  });

  it('支持 @graph 嵌套与 @type 数组', () => {
    withJsonLd({
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'Organization', name: '某公司' },
        { '@type': ['JobPosting', 'Thing'], title: '后端工程师', hiringOrganization: { name: '某公司' } },
      ],
    });
    const context = sniffJobDescription(document);
    expect(context?.title).toBe('后端工程师');
    expect(context?.company).toBe('某公司');
  });

  it('JSON 解析失败时跳过并继续查找下一个脚本', () => {
    document.head.innerHTML = '<script type="application/ld+json">{ not valid json </script>';
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.textContent = JSON.stringify({ '@type': 'JobPosting', title: '数据分析师' });
    document.head.appendChild(script);
    document.body.innerHTML = '';
    expect(sniffJobDescription(document)?.title).toBe('数据分析师');
  });

  it('无 JSON-LD 时回退 DOM 启发式', () => {
    document.head.innerHTML = '';
    document.body.innerHTML = `
      <main>
        <h1 class="job-title">产品经理</h1>
        <span class="company-name">矩阵科技</span>
        <div class="job-detail">
          岗位职责：负责产品规划与上线节奏，协调设计与研发团队，持续优化核心流程与体验。
        </div>
      </main>`;
    const context = sniffJobDescription(document);
    expect(context?.source).toBe('dom');
    expect(context?.confidence).toBe('medium');
    expect(context?.title).toBe('产品经理');
    expect(context?.company).toBe('矩阵科技');
    expect(context?.description).toContain('负责产品规划');
    expect(context?.responsibilities).toContain('负责产品规划与上线节奏');
  });

  it('无岗位信号时返回 undefined', () => {
    document.head.innerHTML = '<title>登录页</title>';
    document.body.innerHTML = '<form><label>用户名</label><input /></form>';
    expect(sniffJobDescription(document)).toBeUndefined();
  });

  it('剥离 script/style 并截断超长描述', () => {
    const long = '要求：'.concat('a'.repeat(30000));
    withJsonLd({ '@type': 'JobPosting', title: '测试', description: `<script>alert(1)</script><p>${long}</p>` });
    const context = sniffJobDescription(document);
    expect(context?.description).toBeDefined();
    expect(context?.description?.includes('alert(1)')).toBe(false);
    expect(context?.description?.length).toBeLessThanOrEqual(20000);
  });
});
