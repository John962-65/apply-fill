import { describe, expect, it } from 'vitest';

import { CascaderWalker } from '@/actuator/CascaderWalker';
import { SelectAgent } from '@/actuator/SelectAgent';
import { PortalTracker } from '@/perceptor';

import { mustQuery } from './helpers';

const FAST_SELECT = {
  popupTimeoutMs: 200,
  searchSettleMs: 10,
  scrollSettleMs: 10,
  commitPollMs: 10,
  commitTimeoutMs: 200,
};

interface PortalFixture {
  trigger: HTMLElement;
  committed(): string;
  optionClicks(): number;
}

function setupPortalSelect(options: string[]): PortalFixture {
  document.body.innerHTML = `
    <div data-combobox-root>
      <div id="trigger" role="combobox" aria-haspopup="listbox" aria-expanded="false"
           aria-controls="popup" tabindex="0"><span id="display">请选择</span></div>
      <input type="hidden" id="hidden" />
    </div>`;
  const trigger = mustQuery<HTMLElement>('#trigger');
  const display = mustQuery<HTMLElement>('#display');
  const hidden = mustQuery<HTMLInputElement>('#hidden');
  let clicks = 0;
  const commit = (text: string) => {
    trigger.setAttribute('data-committed', text);
    display.textContent = text;
    hidden.value = text;
  };
  trigger.addEventListener('click', () => {
    if (document.getElementById('popup') !== null) {
      return;
    }
    const overlay = document.createElement('div');
    overlay.id = 'popup';
    overlay.setAttribute('role', 'listbox');
    for (const option of options) {
      const item = document.createElement('div');
      item.setAttribute('role', 'option');
      item.setAttribute('data-value', option);
      item.textContent = option;
      item.addEventListener('click', () => {
        clicks += 1;
        commit(option);
        trigger.setAttribute('aria-expanded', 'false');
        overlay.remove();
      });
      overlay.append(item);
    }
    document.body.append(overlay);
    trigger.setAttribute('aria-expanded', 'true');
  });
  return { trigger, committed: () => trigger.getAttribute('data-committed') ?? '', optionClicks: () => clicks };
}

describe('SelectAgent', () => {
  it('普通列表：精确匹配并回写 data-committed → SELECTED', async () => {
    const fixture = setupPortalSelect(['大专', '本科', '硕士']);
    const agent = new SelectAgent(new PortalTracker(), FAST_SELECT);
    const outcome = await agent.select(fixture.trigger, '本科');
    expect(outcome.status, outcome.reason).toBe('SELECTED');
    expect(outcome.matchedText).toBe('本科');
    expect(outcome.usedSearch).toBe(false);
    expect(fixture.committed()).toBe('本科');
    expect(fixture.optionClicks()).toBe(1);
  });

  it('纯数字目标只允许精确匹配：不得误选 10/11/12', async () => {
    const fixture = setupPortalSelect(['1', '10', '11', '12']);
    const agent = new SelectAgent(new PortalTracker(), FAST_SELECT);
    const outcome = await agent.select(fixture.trigger, '1');
    expect(outcome.status, outcome.reason).toBe('SELECTED');
    expect(fixture.committed()).toBe('1');
  });

  it('搜索优先：输入后过滤列表并精确命中', async () => {
    document.body.innerHTML = `
      <div data-combobox-root>
        <div id="trigger" role="combobox" aria-haspopup="listbox" aria-expanded="false"
             aria-controls="popup" tabindex="0"><span id="display">请选择</span></div>
      </div>`;
    const trigger = mustQuery<HTMLElement>('#trigger');
    const display = mustQuery<HTMLElement>('#display');
    const all = ['1', '2', '3', '10', '11', '12'];
    trigger.addEventListener('click', () => {
      if (document.getElementById('popup') !== null) {
        return;
      }
      const overlay = document.createElement('div');
      overlay.id = 'popup';
      overlay.setAttribute('role', 'listbox');
      const search = document.createElement('input');
      search.type = 'text';
      overlay.append(search);
      const list = document.createElement('div');
      overlay.append(list);
      const render = (filter: string) => {
        list.innerHTML = '';
        for (const option of all.filter((item) => item.includes(filter))) {
          const item = document.createElement('div');
          item.setAttribute('role', 'option');
          item.textContent = option;
          item.addEventListener('click', () => {
            trigger.setAttribute('data-committed', option);
            display.textContent = option;
            trigger.setAttribute('aria-expanded', 'false');
            overlay.remove();
          });
          list.append(item);
        }
      };
      render('');
      search.addEventListener('input', () => render(search.value));
      document.body.append(overlay);
      trigger.setAttribute('aria-expanded', 'true');
    });
    const agent = new SelectAgent(new PortalTracker(), FAST_SELECT);
    const outcome = await agent.select(trigger, '1');
    expect(outcome.status, outcome.reason).toBe('SELECTED');
    expect(outcome.usedSearch).toBe(true);
    expect(trigger.getAttribute('data-committed')).toBe('1');
  });

  it('虚拟滚动：跨窗口滚动后在后续批次命中', async () => {
    document.body.innerHTML = `
      <div data-combobox-root>
        <div id="trigger" role="combobox" aria-haspopup="listbox" aria-expanded="false"
             aria-controls="popup" tabindex="0"><span id="display">请选择</span></div>
      </div>`;
    const trigger = mustQuery<HTMLElement>('#trigger');
    const display = mustQuery<HTMLElement>('#display');
    const all = ['专业1', '专业2', '专业3', '专业4', '专业5', '专业6', '专业7', '专业8', '专业9', '专业10', '专业11', '专业12'];
    const windowOne = all.slice(0, 8);
    const windowTwo = all.slice(8);
    trigger.addEventListener('click', () => {
      if (document.getElementById('popup') !== null) {
        return;
      }
      const overlay = document.createElement('div');
      overlay.id = 'popup';
      overlay.setAttribute('role', 'listbox');
      const scroller = document.createElement('div');
      Object.defineProperty(scroller, 'scrollHeight', { value: 600 });
      Object.defineProperty(scroller, 'clientHeight', { value: 100 });
      const list = document.createElement('div');
      scroller.append(list);
      overlay.append(scroller);
      const itemClick = (option: string) => () => {
        trigger.setAttribute('data-committed', option);
        display.textContent = option;
        trigger.setAttribute('aria-expanded', 'false');
        overlay.remove();
      };
      const render = (batch: string[]) => {
        list.innerHTML = '';
        for (const option of batch) {
          const item = document.createElement('div');
          item.setAttribute('role', 'option');
          item.textContent = option;
          item.addEventListener('click', itemClick(option));
          list.append(item);
        }
      };
      render(windowOne);
      scroller.addEventListener('scroll', () => {
        if (scroller.scrollTop > 0) {
          render(windowTwo);
        }
      });
      document.body.append(overlay);
      trigger.setAttribute('aria-expanded', 'true');
    });
    const agent = new SelectAgent(new PortalTracker(), FAST_SELECT);
    const outcome = await agent.select(trigger, '专业11');
    expect(outcome.status, outcome.reason).toBe('SELECTED');
    expect(trigger.getAttribute('data-committed')).toBe('专业11');
  });

  it('多重精确匹配 → AMBIGUOUS_OPTION', async () => {
    const fixture = setupPortalSelect(['本科', '本科']);
    const agent = new SelectAgent(new PortalTracker(), FAST_SELECT);
    const outcome = await agent.select(fixture.trigger, '本科');
    expect(outcome.status, outcome.reason).toBe('AMBIGUOUS_OPTION');
    expect(fixture.optionClicks()).toBe(0);
  });

  it('无弹层 → NO_POPUP；空列表 → NO_PROGRESS', async () => {
    document.body.innerHTML = `
      <div data-combobox-root>
        <div id="trigger" role="combobox" aria-haspopup="listbox" aria-expanded="false"></div>
      </div>`;
    const trigger = mustQuery<HTMLElement>('#trigger');
    const agent = new SelectAgent(new PortalTracker(), FAST_SELECT);
    expect((await agent.select(trigger, '本科')).status).toBe('NO_POPUP');

    document.body.innerHTML = `
      <div data-combobox-root>
        <div id="trigger" role="combobox" aria-haspopup="listbox" aria-expanded="false"
             aria-controls="popup"></div>
      </div>`;
    const trigger2 = mustQuery<HTMLElement>('#trigger');
    trigger2.addEventListener('click', () => {
      const overlay = document.createElement('div');
      overlay.id = 'popup';
      overlay.setAttribute('role', 'listbox');
      document.body.append(overlay);
      trigger2.setAttribute('aria-expanded', 'true');
    });
    const outcome = await agent.select(trigger2, '本科');
    expect(outcome.status, outcome.reason).toBe('NO_PROGRESS');
  });

  it('无匹配选项 → NO_OPTION', async () => {
    const fixture = setupPortalSelect(['大专', '本科', '硕士']);
    const agent = new SelectAgent(new PortalTracker(), FAST_SELECT);
    const outcome = await agent.select(fixture.trigger, '博士');
    expect(outcome.status, outcome.reason).toBe('NO_OPTION');
    expect(fixture.optionClicks()).toBe(0);
  });
});

describe('CascaderWalker', () => {
  it('逐列点击直至完整路径并回写', async () => {
    document.body.innerHTML = `
      <div data-combobox-root>
        <div id="trigger" role="combobox" aria-haspopup="tree" aria-expanded="false"
             aria-controls="cascade-popup" tabindex="0"><span id="display">请选择</span></div>
      </div>`;
    const trigger = mustQuery<HTMLElement>('#trigger');
    const display = mustQuery<HTMLElement>('#display');
    const levels: Record<string, string[]> = {
      '广东省': ['深圳市', '广州市'],
      '深圳市': ['南山区', '福田区'],
    };
    trigger.addEventListener('click', () => {
      if (document.getElementById('cascade-popup') !== null) {
        return;
      }
      const overlay = document.createElement('div');
      overlay.id = 'cascade-popup';
      overlay.setAttribute('role', 'dialog');
      const addColumn = (options: string[]) => {
        const column = document.createElement('div');
        column.setAttribute('role', 'listbox');
        for (const option of options) {
          const item = document.createElement('div');
          item.setAttribute('role', 'option');
          item.textContent = option;
          item.addEventListener('click', () => {
            const next = levels[option];
            if (next !== undefined) {
              addColumn(next);
              return;
            }
            const path = ['广东省', '深圳市', option].join(' / ');
            trigger.setAttribute('data-committed', path);
            display.textContent = path;
            trigger.setAttribute('aria-expanded', 'false');
            overlay.remove();
          });
          column.append(item);
        }
        overlay.append(column);
      };
      addColumn(['广东省', '北京市']);
      document.body.append(overlay);
      trigger.setAttribute('aria-expanded', 'true');
    });
    const walker = new CascaderWalker(new PortalTracker(), {
      popupTimeoutMs: 200,
      columnTimeoutMs: 200,
      columnSettleMs: 10,
      commitPollMs: 10,
      commitTimeoutMs: 200,
    });
    expect(CascaderWalker.splitLevels('广东省/深圳市/南山区')).toEqual(['广东省', '深圳市', '南山区']);
    expect(CascaderWalker.splitLevels('广东省 深圳市、南山区')).toEqual(['广东省', '深圳市', '南山区']);
    const outcome = await walker.walk(trigger, '广东省/深圳市/南山区');
    expect(outcome.status, outcome.reason).toBe('SELECTED');
    expect(trigger.getAttribute('data-committed')).toBe('广东省 / 深圳市 / 南山区');
  });

  it('单级文本 → NOT_CASCADER；缺失列 → NO_OPTION', async () => {
    document.body.innerHTML = `
      <div data-combobox-root>
        <div id="trigger" role="combobox" aria-haspopup="tree" aria-expanded="false"
             aria-controls="cascade-popup" tabindex="0"></div>
      </div>`;
    const trigger = mustQuery<HTMLElement>('#trigger');
    const walker = new CascaderWalker(new PortalTracker(), {
      popupTimeoutMs: 100,
      columnTimeoutMs: 100,
      columnSettleMs: 10,
      commitPollMs: 10,
      commitTimeoutMs: 100,
    });
    const single = await walker.walk(trigger, '本科');
    expect(single.status).toBe('FAILED');
    expect(single.reason).toBe('NOT_CASCADER');

    trigger.addEventListener('click', () => {
      const overlay = document.createElement('div');
      overlay.id = 'cascade-popup';
      overlay.setAttribute('role', 'dialog');
      const column = document.createElement('div');
      column.setAttribute('role', 'listbox');
      for (const option of ['广东省', '北京市']) {
        const item = document.createElement('div');
        item.setAttribute('role', 'option');
        item.textContent = option;
        column.append(item);
      }
      overlay.append(column);
      document.body.append(overlay);
      trigger.setAttribute('aria-expanded', 'true');
    });
    const missing = await walker.walk(trigger, '广东省/深圳市/南山区');
    expect(missing.status).toBe('NO_OPTION');
  });
});
