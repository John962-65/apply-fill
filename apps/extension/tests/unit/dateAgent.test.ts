import { describe, expect, it } from 'vitest';

import { DateAgent } from '@/actuator/DateAgent';
import {
  classifyDateText,
  classifyOverlayView,
  hasDateElementHints,
} from '@/actuator/DateViewClassifier';
import { SelectAgent } from '@/actuator/SelectAgent';
import { PortalTracker } from '@/perceptor';
import type { FieldSignature } from '@/shared/contracts/field';
import { NativeCommitPredicate } from '@/verifier/CommitPredicate';

import { mustQuery } from './helpers';

const FAST_DATE_CONFIG = {
  popupTimeoutMs: 200,
  settleMs: 5,
  pollMs: 10,
  commitTimeoutMs: 300,
  budget: { maxActions: 120, maxElapsedMs: 8000, maxNoProgress: 2, maxRetries: 1 },
};

interface CalendarOptions {
  openYear: number;
  openMonth: number;
  stuckPager?: boolean;
}

interface CalendarFixture {
  trigger: HTMLElement;
  committed(): string;
  dayClicks(): number;
  pagerClicks(): number;
}

const pad = (value: number) => String(value).padStart(2, '0');

function setupCalendar(options: CalendarOptions): CalendarFixture {
  document.body.innerHTML = `
    <div data-combobox-root>
      <div id="trigger" role="combobox" aria-haspopup="dialog" aria-expanded="false"
           aria-controls="date-popup" placeholder="请选择日期" tabindex="0"><span id="display">请选择日期</span></div>
      <input type="hidden" id="hidden" />
    </div>`;
  const trigger = mustQuery<HTMLElement>('#trigger');
  const display = mustQuery<HTMLElement>('#display');
  const hidden = mustQuery<HTMLInputElement>('#hidden');
  let clicks = 0;
  let pager = 0;
  let view: 'day' | 'year' | 'month' = 'day';
  let viewYear = options.openYear;
  let viewMonth = options.openMonth;
  let decadeStart = Math.floor(options.openYear / 10) * 10;
  trigger.addEventListener('click', () => {
    if (document.getElementById('date-popup') !== null) {
      return;
    }
    const overlay = document.createElement('div');
    overlay.id = 'date-popup';
    overlay.setAttribute('role', 'dialog');
    document.body.append(overlay);
    trigger.setAttribute('aria-expanded', 'true');
    const commit = (text: string) => {
      trigger.setAttribute('data-committed', text);
      display.textContent = text;
      hidden.value = text;
      trigger.setAttribute('aria-expanded', 'false');
      overlay.remove();
    };
    const render = () => {
      overlay.innerHTML = '';
      const header = document.createElement('button');
      header.className = 'date-header';
      if (view === 'day') {
        header.textContent = `${viewYear}年${viewMonth}月`;
        header.addEventListener('click', () => {
          view = 'year';
          decadeStart = Math.floor(viewYear / 10) * 10;
          render();
        });
      } else if (view === 'month') {
        header.textContent = `${viewYear}年`;
      } else {
        header.textContent = `${decadeStart}年-${decadeStart + 9}年`;
      }
      overlay.append(header);
      if (view === 'day') {
        const prev = document.createElement('button');
        prev.setAttribute('aria-label', '上个月');
        prev.textContent = '‹';
        prev.addEventListener('click', () => {
          pager += 1;
          viewMonth -= 1;
          if (viewMonth < 1) {
            viewMonth = 12;
            viewYear -= 1;
          }
          render();
        });
        const next = document.createElement('button');
        next.setAttribute('aria-label', '下个月');
        next.textContent = '›';
        next.addEventListener('click', () => {
          pager += 1;
          viewMonth += 1;
          if (viewMonth > 12) {
            viewMonth = 1;
            viewYear += 1;
          }
          render();
        });
        overlay.append(prev, next);
        const grid = document.createElement('div');
        grid.setAttribute('role', 'grid');
        const days = new Date(viewYear, viewMonth, 0).getDate();
        for (let day = 1; day <= days; day += 1) {
          const cell = document.createElement('button');
          cell.setAttribute('data-day', String(day));
          cell.textContent = String(day);
          cell.addEventListener('click', () => {
            clicks += 1;
            commit(`${viewYear}-${pad(viewMonth)}-${pad(day)}`);
          });
          grid.append(cell);
        }
        overlay.append(grid);
      }
      if (view === 'year') {
        const prevDecade = document.createElement('button');
        prevDecade.setAttribute('aria-label', '上十年');
        prevDecade.textContent = '«';
        prevDecade.addEventListener('click', () => {
          pager += 1;
          if (options.stuckPager !== true) {
            decadeStart -= 10;
          }
          render();
        });
        const nextDecade = document.createElement('button');
        nextDecade.setAttribute('aria-label', '下十年');
        nextDecade.textContent = '»';
        nextDecade.addEventListener('click', () => {
          pager += 1;
          if (options.stuckPager !== true) {
            decadeStart += 10;
          }
          render();
        });
        overlay.append(prevDecade, nextDecade);
        for (let year = decadeStart; year < decadeStart + 10; year += 1) {
          const cell = document.createElement('button');
          cell.setAttribute('data-year', String(year));
          cell.textContent = String(year);
          cell.addEventListener('click', () => {
            viewYear = year;
            view = 'month';
            render();
          });
          overlay.append(cell);
        }
      }
      if (view === 'month') {
        for (let month = 1; month <= 12; month += 1) {
          const cell = document.createElement('button');
          cell.setAttribute('data-month', String(month));
          cell.textContent = `${month}月`;
          cell.addEventListener('click', () => {
            viewMonth = month;
            view = 'day';
            render();
          });
          overlay.append(cell);
        }
      }
    };
    render();
  });
  return {
    trigger,
    committed: () => trigger.getAttribute('data-committed') ?? '',
    dayClicks: () => clicks,
    pagerClicks: () => pager,
  };
}

function makeAgent(): DateAgent {
  const tracker = new PortalTracker({ pollMs: 10, defaultTimeoutMs: 200 });
  const selectAgent = new SelectAgent(tracker, {
    popupTimeoutMs: 100,
    searchSettleMs: 5,
    scrollSettleMs: 5,
    commitPollMs: 5,
    commitTimeoutMs: 150,
  });
  return new DateAgent(tracker, selectAgent, FAST_DATE_CONFIG);
}

describe('DateViewClassifier', () => {
  it('文本分类：完整日期/年月/年份/至今/范围', () => {
    expect(classifyDateText('2026-03-15').kind).toBe('atom');
    expect(classifyDateText('2026-03').kind).toBe('atom');
    expect(classifyDateText('2026').kind).toBe('atom');
    expect(classifyDateText('至今').kind).toBe('present');
    const range = classifyDateText('2020-09 ~ 2022-06');
    expect(range.kind).toBe('range');
    expect(range.start?.year).toBe(2020);
    expect(range.end?.month).toBe(6);
    expect(classifyDateText('本科').kind).toBe('none');
  });

  it('元素提示：placeholder/类名/完整日期值', () => {
    document.body.innerHTML = `
      <div class="ant-picker"><div id="a" role="combobox" aria-expanded="false"></div></div>
      <div id="b" role="combobox" aria-expanded="false" placeholder="毕业时间"></div>
      <div id="c" role="combobox" aria-expanded="false">2022-06-30</div>
      <div id="d" role="combobox" aria-expanded="false"><span>请选择</span></div>`;
    expect(hasDateElementHints(mustQuery<HTMLElement>('#a'))).toBe(true);
    expect(hasDateElementHints(mustQuery<HTMLElement>('#b'))).toBe(true);
    expect(hasDateElementHints(mustQuery<HTMLElement>('#c'))).toBe(true);
    expect(hasDateElementHints(mustQuery<HTMLElement>('#d'))).toBe(false);
  });

  it('元素提示：已提交的范围文本视为日期控件（重跑幂等）', () => {
    document.body.innerHTML = `
      <div id="e" role="combobox" aria-expanded="false">2020-09-01 ~ 2022-06-30</div>
      <div id="f" role="combobox" aria-expanded="false" data-committed="2020-09 ~ 2022-06"><span>开始 结束</span></div>
      <div id="g" role="combobox" aria-expanded="false"><span>本科</span></div>`;
    expect(hasDateElementHints(mustQuery<HTMLElement>('#e'))).toBe(true);
    expect(hasDateElementHints(mustQuery<HTMLElement>('#f'))).toBe(true);
    expect(hasDateElementHints(mustQuery<HTMLElement>('#g'))).toBe(false);
  });

  it('浮层视图分类：日网格/年面板/月面板/列表', () => {
    const build = (html: string) => {
      const overlay = document.createElement('div');
      overlay.innerHTML = html;
      document.body.append(overlay);
      return overlay;
    };
    const days = Array.from({ length: 31 }, (_, index) => `<button data-day="${index + 1}">${index + 1}</button>`).join('');
    expect(classifyOverlayView(build(`<div>${days}</div>`))).toBe('day-grid');
    const years = Array.from({ length: 10 }, (_, index) => `<button>${2016 + index}</button>`).join('');
    expect(classifyOverlayView(build(`<div>${years}</div>`))).toBe('year-panel');
    const months = Array.from({ length: 12 }, (_, index) => `<button>${index + 1}月</button>`).join('');
    expect(classifyOverlayView(build(`<div>${months}</div>`))).toBe('month-panel');
    expect(classifyOverlayView(build('<div role="listbox"><div>本科</div></div>'))).toBe('list');
  });
});

describe('DateAgent', () => {
  it('跨十年翻页：从 2014-06 导航到 2026-03-15 并提交', async () => {
    const fixture = setupCalendar({ openYear: 2014, openMonth: 6 });
    const agent = makeAgent();
    const outcome = await agent.fill(fixture.trigger, '2026-03-15');
    expect(outcome.status).toBe('SELECTED');
    expect(fixture.committed()).toBe('2026-03-15');
    expect(fixture.dayClicks()).toBe(1);
    expect(fixture.pagerClicks()).toBeGreaterThan(0);
  });

  it('同月直接选日：2026-03 面板点击 15', async () => {
    const fixture = setupCalendar({ openYear: 2026, openMonth: 3 });
    const agent = makeAgent();
    const outcome = await agent.fill(fixture.trigger, '2026-03-15');
    expect(outcome.status).toBe('SELECTED');
    expect(fixture.committed()).toBe('2026-03-15');
  });

  it('月精度：无日值默认 1 号并允许月级提交', async () => {
    const fixture = setupCalendar({ openYear: 2022, openMonth: 6 });
    const agent = makeAgent();
    const outcome = await agent.fill(fixture.trigger, '2022-06');
    expect(outcome.status).toBe('SELECTED');
    expect(fixture.committed()).toBe('2022-06-01');
  });

  it('翻页无进展两次 → NO_PROGRESS', async () => {
    const fixture = setupCalendar({ openYear: 2014, openMonth: 6, stuckPager: true });
    const agent = makeAgent();
    const outcome = await agent.fill(fixture.trigger, '2026-03-15');
    expect(outcome.status).toBe('NO_PROGRESS');
    expect(fixture.dayClicks()).toBe(0);
  });

  it('列表型浮层委托 SelectAgent：年份列表仍可选中', async () => {
    document.body.innerHTML = `
      <div data-combobox-root>
        <div id="trigger" role="combobox" aria-haspopup="listbox" aria-expanded="false"
             aria-controls="year-popup" placeholder="请选择日期"><span id="display">请选择日期</span></div>
        <input type="hidden" id="hidden" />
      </div>`;
    const trigger = mustQuery<HTMLElement>('#trigger');
    trigger.addEventListener('click', () => {
      if (document.getElementById('year-popup') !== null) {
        return;
      }
      const overlay = document.createElement('div');
      overlay.id = 'year-popup';
      overlay.setAttribute('role', 'listbox');
      for (const year of ['2024', '2025', '2026']) {
        const item = document.createElement('div');
        item.setAttribute('role', 'option');
        item.setAttribute('data-value', year);
        item.textContent = year;
        item.addEventListener('click', () => {
          trigger.setAttribute('data-committed', year);
          mustQuery<HTMLElement>('#display').textContent = year;
          mustQuery<HTMLInputElement>('#hidden').value = year;
          trigger.setAttribute('aria-expanded', 'false');
          overlay.remove();
        });
        overlay.append(item);
      }
      document.body.append(overlay);
      trigger.setAttribute('aria-expanded', 'true');
    });
    const agent = makeAgent();
    const outcome = await agent.fill(trigger, '2026');
    expect(outcome.status).toBe('SELECTED');
    expect(trigger.getAttribute('data-committed')).toBe('2026');
  });

  it('无日期提示的普通组合框 → NOT_DATE（不接管年份/月份列表）', async () => {
    document.body.innerHTML = `
      <div data-combobox-root>
        <div id="trigger" role="combobox" aria-haspopup="listbox" aria-expanded="false"><span>请选择</span></div>
      </div>`;
    const trigger = mustQuery<HTMLElement>('#trigger');
    const agent = makeAgent();
    expect((await agent.fill(trigger, '2026')).status).toBe('NOT_DATE');
    expect((await agent.fill(trigger, '本科')).status).toBe('NOT_DATE');
  });

  it('至今：容器内复选控件被勾选', async () => {
    document.body.innerHTML = `
      <div class="range-field">
        <div id="trigger" role="combobox" aria-haspopup="dialog" aria-expanded="false" placeholder="结束日期"></div>
        <label><input type="checkbox" id="present" /> 至今</label>
      </div>`;
    const trigger = mustQuery<HTMLElement>('#trigger');
    const checkbox = mustQuery<HTMLInputElement>('#present');
    const agent = makeAgent();
    const outcome = await agent.fill(trigger, '至今');
    expect(outcome.status).toBe('SELECTED');
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(checkbox.checked).toBe(true);
  });

  it('至今：被容器包裹时优先点击可激活控件而非外层 div', async () => {
    document.body.innerHTML = `
      <div class="range-field">
        <div id="trigger" role="combobox" aria-haspopup="dialog" aria-expanded="false" placeholder="结束日期"></div>
        <div id="present-popup" role="dialog">
          <div><label><input type="checkbox" id="present" /> 至今</label></div>
        </div>
      </div>`;
    const trigger = mustQuery<HTMLElement>('#trigger');
    const checkbox = mustQuery<HTMLInputElement>('#present');
    const agent = makeAgent();
    const outcome = await agent.fill(trigger, '至今');
    expect(outcome.status).toBe('SELECTED');
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(checkbox.checked).toBe(true);
  });
});

describe('DateAgent range', () => {
  interface RangeFixture {
    trigger: HTMLElement;
    committed(): string;
    presentMode?: () => void;
  }

  function setupRange(openYear: number, openMonth: number, withPresent: boolean): RangeFixture {
    document.body.innerHTML = `
      <div data-combobox-root>
        <div id="trigger" role="combobox" aria-haspopup="dialog" aria-expanded="false"
             aria-controls="range-popup" placeholder="开始日期 结束日期"><span id="display">请选择</span></div>
        <input type="hidden" id="hidden" />
      </div>`;
    const trigger = mustQuery<HTMLElement>('#trigger');
    const display = mustQuery<HTMLElement>('#display');
    const hidden = mustQuery<HTMLInputElement>('#hidden');
    let startPick: string | undefined;
    const pad2 = pad;
    trigger.addEventListener('click', () => {
      if (document.getElementById('range-popup') !== null) {
        return;
      }
      const overlay = document.createElement('div');
      overlay.id = 'range-popup';
      overlay.setAttribute('role', 'dialog');
      let leftYear = openYear;
      let leftMonth = openMonth;
      let rightYear = openYear;
      let rightMonth = openMonth;
      const commit = () => {
        const text = `${startPick ?? ''} ~ 至今`;
        trigger.setAttribute('data-committed', text);
        display.textContent = text;
        hidden.value = text;
        trigger.setAttribute('aria-expanded', 'false');
        overlay.remove();
      };
      const renderPanel = (side: 'start' | 'end') => {
        const panel = document.createElement('div');
        panel.className = 'date-panel';
        const isStart = side === 'start';
        let year = isStart ? leftYear : rightYear;
        let month = isStart ? leftMonth : rightMonth;
        const header = document.createElement('span');
        header.className = 'date-header';
        header.textContent = `${year}年${month}月`;
        panel.append(header);
        const prev = document.createElement('button');
        prev.setAttribute('aria-label', '上个月');
        prev.textContent = '‹';
        prev.addEventListener('click', () => {
          month -= 1;
          if (month < 1) {
            month = 12;
            year -= 1;
          }
          if (isStart) {
            leftYear = year;
            leftMonth = month;
          } else {
            rightYear = year;
            rightMonth = month;
          }
          render();
        });
        const next = document.createElement('button');
        next.setAttribute('aria-label', '下个月');
        next.textContent = '›';
        next.addEventListener('click', () => {
          month += 1;
          if (month > 12) {
            month = 1;
            year += 1;
          }
          if (isStart) {
            leftYear = year;
            leftMonth = month;
          } else {
            rightYear = year;
            rightMonth = month;
          }
          render();
        });
        panel.append(prev, next);
        const grid = document.createElement('div');
        grid.setAttribute('role', 'grid');
        const days = new Date(year, month, 0).getDate();
        for (let day = 1; day <= days; day += 1) {
          const cell = document.createElement('button');
          cell.setAttribute('data-day', String(day));
          cell.textContent = String(day);
          cell.addEventListener('click', () => {
            if (isStart) {
              startPick = `${year}-${pad2(month)}-${pad2(day)}`;
              rightYear = year;
              rightMonth = month;
              render();
            } else if (withPresent) {
              commit();
            } else {
              const text = `${startPick ?? ''} ~ ${year}-${pad2(month)}-${pad2(day)}`;
              trigger.setAttribute('data-committed', text);
              display.textContent = text;
              hidden.value = text;
              trigger.setAttribute('aria-expanded', 'false');
              overlay.remove();
            }
          });
          grid.append(cell);
        }
        panel.append(grid);
        return panel;
      };
      const render = () => {
        overlay.innerHTML = '';
        overlay.append(renderPanel('start'), renderPanel('end'));
        if (withPresent) {
          const label = document.createElement('label');
          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          label.append(checkbox, document.createTextNode(' 至今'));
          label.addEventListener('click', () => commit());
          overlay.append(label);
        }
      };
      render();
      document.body.append(overlay);
      trigger.setAttribute('aria-expanded', 'true');
    });
    return { trigger, committed: () => trigger.getAttribute('data-committed') ?? '' };
  }

  it('范围：起止月自动补齐首日与末日', async () => {
    const fixture = setupRange(2019, 6, false);
    const agent = makeAgent();
    const outcome = await agent.fill(fixture.trigger, '2020-09 ~ 2022-06');
    expect(outcome.status).toBe('SELECTED');
    expect(fixture.committed()).toBe('2020-09-01 ~ 2022-06-30');
  });

  it('范围+至今：选择起始日后勾选至今', async () => {
    const fixture = setupRange(2020, 1, true);
    const agent = makeAgent();
    const outcome = await agent.fill(fixture.trigger, '2020-09 ~ 至今');
    expect(outcome.status).toBe('SELECTED');
    expect(fixture.committed()).toBe('2020-09-01 ~ 至今');
  });
});

describe('CommitPredicate date', () => {
  function contextFor(element: Element, expectedText: string): Parameters<NativeCommitPredicate['verify']>[0] {
    const signature: FieldSignature = {
      fieldKey: 'fk_date',
      label: '日期',
      labelSource: 'label-for',
      controlKind: 'date',
      sectionType: 'basic',
      instanceId: 'instance_01',
      required: false,
      readonly: false,
      disabled: false,
      componentHints: [],
      descriptor: {
        formId: 'form',
        stepId: 'step',
        sectionType: 'basic',
        normalizedLabel: '日期',
        controlKind: 'date',
      },
    };
    return {
      fieldKey: 'fk_date',
      controlKind: 'date',
      signature,
      element,
      expectedValue: expectedText,
      expectedText,
      signal: new AbortController().signal,
    };
  }

  it('原生 date：月精度期望匹配到日值', async () => {
    document.body.innerHTML = `<input type="date" id="d" />`;
    const input = mustQuery<HTMLInputElement>('#d');
    input.value = '2026-03-01';
    const predicate = new NativeCommitPredicate();
    const result = await predicate.verify(contextFor(input, '2026-03'));
    expect(result.status).toBe('CONFIRMED');
  });

  it('原生 date：不匹配的日值 → REJECTED', async () => {
    document.body.innerHTML = `<input type="date" id="d" />`;
    const input = mustQuery<HTMLInputElement>('#d');
    input.value = '2026-04-02';
    const predicate = new NativeCommitPredicate();
    const result = await predicate.verify(contextFor(input, '2026-03-15'));
    expect(result.status).toBe('REJECTED');
  });

  it('日期串容忍连字符与空值（至今）比较', async () => {
    document.body.innerHTML = `<input type="text" id="t" />`;
    const input = mustQuery<HTMLInputElement>('#t');
    input.value = '至今';
    const predicate = new NativeCommitPredicate();
    expect((await predicate.verify(contextFor(input, '至今'))).status).toBe('CONFIRMED');
    expect((await predicate.verify(contextFor(input, '2026-01'))).status).toBe('REJECTED');
  });

  it('组合框范围提交：补全的日值与月精度期望按范围容忍比较', async () => {
    document.body.innerHTML = `
      <div data-combobox-root>
        <div id="range" role="combobox" aria-expanded="false"
             data-committed="2020-09-01 ~ 2022-06-30"><span>2020-09-01 ~ 2022-06-30</span></div>
      </div>`;
    const trigger = mustQuery<HTMLElement>('#range');
    const predicate = new NativeCommitPredicate();
    const context = contextFor(trigger, '2020-09 ~ 2022-06');
    context.controlKind = 'combobox';
    expect((await predicate.verify(context)).status).toBe('CONFIRMED');

    trigger.setAttribute('data-committed', '2020-09-01 ~ 2022-07-31');
    expect((await predicate.verify(context)).status).toBe('REJECTED');
  });
});
