import { describe, expect, it } from 'vitest';

import { expandSection } from '@/perceptor/RepeaterManager';
import { scanRepeatableSections } from '@/perceptor/SectionScanner';
import type { ScannedSection } from '@/perceptor/SectionScanner';

function projectItem(name: string): string {
  return `
    <div class="item">
      <label>项目名称<input name="projectName" data-item="${name}" /></label>
      <label>开始时间<input name="projectStart" /></label>
    </div>`;
}

function setupRepeater(addButton: boolean, onClick?: (host: HTMLElement) => void): ScannedSection {
  document.body.innerHTML = `
    <section id="projects">
      <h2>项目经历</h2>
      <div class="list">${projectItem('A')}</div>
      ${addButton ? '<button type="button" id="add">添加项目</button>' : ''}
    </section>`;
  if (onClick !== undefined) {
    const button = document.getElementById('add');
    if (button !== null) {
      const list = document.querySelector('.list');
      button.addEventListener('click', () => {
        if (list !== null) {
          onClick(list as HTMLElement);
        }
      });
    }
  }
  const section = scanRepeatableSections(document).find((item) => item.sectionType === 'project');
  if (section === undefined) {
    throw new Error('project section not found');
  }
  return section;
}

describe('expandSection', () => {
  it('已达到目标数量时直接返回', async () => {
    const section = setupRepeater(true);
    const result = await expandSection(section, 1);
    expect(result.status).toBe('ALREADY_ENOUGH');
    expect(result.after).toBe(1);
    expect(result.clicks).toBe(0);
  });

  it('点击添加按钮直至达到目标数量', async () => {
    const section = setupRepeater(true, (host) => {
      const wrapper = document.createElement('div');
      wrapper.innerHTML = projectItem('X');
      const item = wrapper.firstElementChild;
      if (item !== null) {
        host.appendChild(item);
      }
    });
    const result = await expandSection(section, 3, { perAddTimeoutMs: 500 });
    expect(result.status).toBe('EXPANDED');
    expect(result.before).toBe(1);
    expect(result.after).toBe(3);
    expect(result.clicks).toBe(2);
  });

  it('添加无响应时停止点击避免无限循环', async () => {
    const section = setupRepeater(true);
    const result = await expandSection(section, 3, { perAddTimeoutMs: 100 });
    expect(result.status).toBe('NO_PROGRESS');
    expect(result.clicks).toBe(1);
    expect(result.after).toBe(1);
  });

  it('缺少添加按钮时返回 NO_ADD_CONTROL', async () => {
    const section = setupRepeater(false);
    const result = await expandSection(section, 3);
    expect(result.status).toBe('NO_ADD_CONTROL');
  });

  it('达到最大点击次数后返回 NO_PROGRESS', async () => {
    const section = setupRepeater(true, (host) => {
      const wrapper = document.createElement('div');
      wrapper.innerHTML = projectItem('X');
      const item = wrapper.firstElementChild;
      if (item !== null) {
        host.appendChild(item);
      }
    });
    const result = await expandSection(section, 10, { maxAdds: 2, perAddTimeoutMs: 500 });
    expect(result.status).toBe('NO_PROGRESS');
    expect(result.clicks).toBe(2);
    expect(result.after).toBe(3);
  });
});
