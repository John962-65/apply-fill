/* 通用日期交互 Agent：不依赖平台类名。
   打开面板 → 结构分类（活视图，不缓存节点）→ 精度只信页面证据 →
   高置信走合成契约的规则驱动（0 次模型调用）→ 不确定或失败转入 AI 逐步循环。
   AI 只能从本地生成的候选里按 id 选择；值来自上游有来源校验的匹配，Agent 只负责导航到它。 */
(function (root) {
  'use strict';
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const compact = v => String(v ?? '').replace(/\s+/g, '').trim();
  const monthNumber = v => root.ResumeProCalendarAgent?.monthNumber?.(v) ?? null;
  const CONFIRM_TEXT = /^(?:确认|确定|完成|ok|confirm|apply)$/i;
  const YEAR_TEXT = /^\d{4}年?$/;
  const TIME_TEXT = /^\d{1,2}:\d{2}/;
  const MAX_CELLS_PER_GRID = 60;
  const MAX_TIER2 = 24;
  const MAX_ACTIONS = 14;
  const BUDGET_MS = 60000;
  const STALL_LIMIT = 3;
  const NAV_PATTERNS = [
    ['prev-decade', /上一年代|前十年|上十年代|previous decade|prev decade/i],
    ['next-decade', /下一年代|后十年|下十年代|next decade/i],
    ['prev-year', /上一年|前一年|previous year|prev year/i],
    ['next-year', /下一年|后一年|next year/i],
    ['prev-month', /上一月|上个月|previous month|prev month|last month/i],
    ['next-month', /下一月|下个月|next month/i]
  ];

  function create(config) {
    const { visible, click, escape, dismiss, input, read, peerValue, refresh } = config;
    const popup = root.ResumeProPopupController.create({
      visible,
      panelSelector: '[role="dialog"],[class*="picker" i]:not([class*="picker-input" i]):not([class*="picker-label" i]),[class*="calendar" i]:not(input),[class*="datepicker" i],[class*="date-picker" i]',
      optionSelector: '[role="gridcell"],[role="option"],td,[data-date],[class*="cell" i]',
      localInput: entry => entry.element,
      live: entry => Boolean(entry?.element?.isConnected)
    });
    const states = root.ResumeProPopupController.STATES;
    let activeEntry = null;
    const enabled = node => node && !node.closest('[disabled],[aria-disabled="true"],[class*="-disabled"],.disabled');
    const trace = (entry, action, detail = '') => { entry.interactions ??= []; entry.interactions.push({ action, detail }); entry.interactions = entry.interactions.slice(-24); };
    async function until(predicate, ms = 1600) {
      const end = Date.now() + ms;
      do { const value = predicate(); if (value) return value; await wait(80); } while (Date.now() < end);
      return null;
    }

    /* ---------- 弹层归属与生命周期（popup-controller 纪律，镜像 combo-agent） ---------- */

    function panels() { return popup.candidates(); }
    function panelOf(entry) { return popup.inspect(entry).panel; }
    function adopt(entry, related) {
      if (!entry.opened || !entry.beforePanels) entry.beforePanels = new Set(panels().filter(p => p !== related));
      entry.ownedPanel = related; entry.opened = true; activeEntry = entry;
      popup.transition(entry, states.OPEN);
    }
    async function ready(entry) {
      if (activeEntry && activeEntry !== entry && !await closePanel(activeEntry)) {
        if (entry) { entry.popupBlocked = true; entry.fillNote = '前一控件的弹层仍未关闭，已暂停后续填写'; }
        return false;
      }
      return true;
    }
    async function openPanel(entry) {
      if (!entry.element?.isConnected) {
        const fresh = refresh?.(entry);
        if (!fresh?.element?.isConnected) { entry.fillNote = '日期输入框已被替换，不能唯一定位'; return null; }
      }
      entry.trigger = entry.element; entry.root = entry.element;
      if (!await ready(entry)) return null;
      const related = panelOf(entry);
      if (related) { adopt(entry, related); return related; }
      if (entry.panelAmbiguous) throw new Error('无法唯一确认当前日期控件的弹层');
      entry.beforePanels = new Set(panels()); entry.ownedPanel = null; entry.opened = true;
      popup.begin(entry); activeEntry = entry;
      trace(entry, '打开', '点击日期控件');
      await click(entry.trigger);
      await until(() => panelOf(entry), 1800);
      const found = panelOf(entry);
      if (found) adopt(entry, found); else trace(entry, '观察', '未出现可归属的弹层');
      return found;
    }
    async function closePanel(entry) {
      const cleared = () => { entry.opened = false; entry.beforePanels = null; entry.ownedPanel = null; entry.popupBlocked = false; popup.finish(entry); if (activeEntry === entry) activeEntry = null; return true; };
      if (!entry.element?.isConnected) {
        if (entry.ownedPanel?.isConnected && visible(entry.ownedPanel)) { activeEntry = entry; entry.popupBlocked = true; popup.transition(entry, states.BLOCKED, 'POPUP_OWNERSHIP_UNCONFIRMED'); return false; }
        return cleared();
      }
      const owned = panelOf(entry);
      if (!owned && entry.panelAmbiguous) { activeEntry = entry; entry.popupBlocked = true; popup.transition(entry, states.BLOCKED, 'POPUP_OWNERSHIP_UNCONFIRMED'); trace(entry, '关闭未完成', '无法唯一确认关联面板'); return false; }
      if (!owned && !entry.opened) return cleared();
      if (!owned && popup.closed(entry)) return cleared();
      activeEntry = entry;
      popup.transition(entry, states.RECOVERING);
      entry.recoveryEvidence = { escapeAttempted: true, blurAttempted: false, dismissAttempted: false, toggleAttempted: false };
      try {
        const delegated = config.escape?.(entry.trigger);
        if (delegated) await delegated;
        else entry.trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
        entry.element.blur?.(); entry.trigger.blur?.(); entry.recoveryEvidence.blurAttempted = true;
      } catch (error) { trace(entry, '关闭未完成', error.message); }
      if (!await until(() => popup.closed(entry), 180) && dismiss) {
        entry.recoveryEvidence.dismissAttempted = true;
        try { await dismiss(entry.trigger); } catch (error) { trace(entry, '关闭未完成', error.message); }
      }
      if (!await until(() => popup.closed(entry), 700)) {
        entry.recoveryEvidence.toggleAttempted = true;
        try { await click(entry.trigger); } catch (error) { trace(entry, '关闭未完成', error.message); entry.popupBlocked = true; popup.transition(entry, states.BLOCKED, 'POPUP_CLOSE_UNCONFIRMED'); return false; }
        if (!await until(() => popup.closed(entry), 700)) { trace(entry, '关闭未完成', '关联面板仍可见'); entry.popupBlocked = true; popup.transition(entry, states.BLOCKED, 'POPUP_CLOSE_UNCONFIRMED'); return false; }
      }
      return cleared();
    }

    /* ---------- 结构分类：全部现查现用，绝不缓存节点 ---------- */

    function parseDateAttr(text) {
      const s = String(text ?? '').trim();
      let m = /^(\d{4})[-/年](\d{1,2})(?:[-/月](\d{1,2}))?日?/.exec(s);
      if (m) return { y: +m[1], m: +m[2], d: m[3] ? +m[3] : undefined };
      m = /^(\d{4})(?:年|$)/.exec(s);
      return m ? { y: +m[1] } : null;
    }
    function cellInfo(node) {
      const text = compact(node.textContent).slice(0, 16);
      if (!text) return null;
      const attr = parseDateAttr(['data-date', 'title', 'aria-label'].map(k => node.getAttribute(k)).find(Boolean));
      let kind = 'other', value = null;
      if (YEAR_TEXT.test(text)) { kind = 'year'; value = Number(text.replace(/年$/, '')); }
      else if (/^\d{1,2}月$/.test(text) || /^[一二三四五六七八九十]{1,3}月$/.test(text) || /^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(text)) {
        const m = monthNumber(text); if (m >= 1 && m <= 12) { kind = 'month'; value = m; }
      } else if (TIME_TEXT.test(text)) { kind = 'time'; }
      else if (/^\d{1,2}$/.test(text)) { const n = Number(text); if (n >= 1 && n <= 31) { kind = 'num'; value = n; } }
      return { node, text, kind, value, attr };
    }
    function inAny(containerList, node) { return containerList.some(c => c.container === node || c.container.contains(node)); }

    function classifyCalendar(panelNode) {
      if (!panelNode?.isConnected) return null;
      const all = Array.from(panelNode.querySelectorAll('[role="gridcell"],[role="option"],td,[data-date],[class*="cell" i],[class*="month-item" i],[class*="year-item" i]')).filter(visible);
      const outermost = all.filter(n => !all.some(o => o !== n && o.contains(n)));
      const cells = outermost.map(cellInfo).filter(Boolean).filter(c => enabled(c.node));

      // 按容器聚合格子；同模式下取最内层容器，祖先容器不计。
      const byContainer = new Map();
      for (const cell of cells) {
        for (let node = cell.node.parentElement; node && node !== panelNode; node = node.parentElement) {
          if (!byContainer.has(node)) byContainer.set(node, []);
          byContainer.get(node).push(cell);
        }
      }
      const ranked = [...byContainer.entries()].sort((a, b) => b[0].contains(a[0]) ? -1 : a[0].contains(b[0]) ? 1 : 0);
      const grids = [];
      for (const [container, list] of ranked) {
        if (grids.some(g => g.container === container || g.container.contains(container))) continue;
        const years = list.filter(c => c.kind === 'year');
        const months = list.filter(c => c.kind === 'month');
        const nums = list.filter(c => c.kind === 'num');
        const dated = list.filter(c => c.attr && c.attr.d);
        let mode = null, picked = null;
        if (years.length >= 3 && years.length === list.length) { mode = 'year'; picked = years; }
        else if (months.length >= 10 && months.length >= list.length - 2) { mode = 'month'; picked = months; }
        else if (dated.length >= 10) { mode = 'day'; picked = dated; }
        else if (nums.length >= 28) { mode = 'day'; picked = nums; }
        if (mode && picked.length <= MAX_CELLS_PER_GRID + 8) grids.push({ mode, container, cells: picked.slice(0, MAX_CELLS_PER_GRID) });
      }
      const modes = [...new Set(grids.map(g => g.mode))];
      const uniquePerMode = modes.every(mode => grids.filter(g => g.mode === mode).length === 1);

      // 表头：网格之外的最内层年份/月份文字元素。方向性翻页一律只作候选，点击后以状态变化验证。
      const outsideGrids = node => !inAny(grids, node);
      const innermost = list => list.filter(n => !list.some(o => o !== n && n.contains(o)));
      const pool = Array.from(panelNode.querySelectorAll('button,[role="button"],a,span,div,[class*="btn" i],[class*="header" i] *')).filter(n => visible(n) && outsideGrids(n));
      const yearButtons = innermost(pool.filter(n => YEAR_TEXT.test(compact(n.textContent)))).slice(0, 3);
      const monthButtons = innermost(pool.filter(n => !/\d{4}/.test(n.textContent) && monthNumber(compact(n.textContent)) >= 1 && monthNumber(compact(n.textContent)) <= 12)).slice(0, 3);
      // 合并式表头（「2026年10月」一个元素）：当作年/月两个入口的候选，点击后的视图变化再验证。
      if (!yearButtons.length && !monthButtons.length) {
        const combined = innermost(pool.filter(n => /^(\d{4})年(\d{1,2})月$/.test(compact(n.textContent)))).slice(0, 1);
        if (combined.length) { yearButtons.push(...combined); monthButtons.push(...combined); }
      }
      const headerYearNode = yearButtons[0] || pool.find(n => /(\d{4})/.test(n.textContent) && n.textContent.length <= 32);
      const headerMonthNode = monthButtons[0];
      const monthText = headerMonthNode ? compact(headerMonthNode.textContent) : '';
      const combinedMonth = /^(?:\d{4})年(\d{1,2})月$/.exec(monthText);
      const header = {
        year: headerYearNode ? Number((/\d{4}/.exec(headerYearNode.textContent) || [])[0]) || null : null,
        month: headerMonthNode ? (monthNumber(monthText) ?? (combinedMonth ? Number(combinedMonth[1]) : null)) : null
      };

      const navPool = Array.from(panelNode.querySelectorAll('button,[role="button"],a,[aria-label],[class*="prev" i],[class*="next" i],[class*="arrow" i],[class*="super" i]')).filter(n => visible(n) && outsideGrids(n) && !grids.some(g => g.container === n));
      const paging = [];
      for (const node of navPool) {
        const text = `${node.getAttribute('aria-label') || ''} ${node.textContent || ''}`;
        let direction = null, claim = null;
        for (const [dir, re] of NAV_PATTERNS) if (re.test(text)) { direction = dir; claim = 'label'; break; }
        if (!direction) { const glyph = compact(node.getAttribute('aria-label') || node.textContent); if (/^[«‹<←]+$/.test(glyph)) { direction = 'prev'; claim = 'glyph'; } else if (/^[»›>→]+$/.test(glyph)) { direction = 'next'; claim = 'glyph'; } }
        if (direction) paging.push({ node, direction, claim, label: compact(node.getAttribute('aria-label') || node.textContent).slice(0, 20) });
      }
      const pagingOuter = paging.filter(p => !paging.some(o => o.node !== p.node && o.node.contains(p.node))).slice(0, 8);
      // 无标签时的几何回退：面板内恰好一对箭头字形元素，左为 prev 右为 next。方向仍需点击后验证。
      if (!pagingOuter.length) {
        const glyphs = Array.from(panelNode.querySelectorAll('*')).filter(n => visible(n) && enabled(n) && outsideGrids(n)
          && /^[«‹<←]$|^[»›>→]$/.test(compact(n.textContent)) && n.children.length === 0);
        const outermost = glyphs.filter(n => !glyphs.some(o => o !== n && o.contains(n)));
        if (outermost.length === 2) {
          const [a, b] = outermost.sort((x, y) => x.getBoundingClientRect().left - y.getBoundingClientRect().left);
          pagingOuter.push({ node: a, direction: 'prev', claim: 'glyph', label: compact(a.textContent) }, { node: b, direction: 'next', claim: 'glyph', label: compact(b.textContent) });
        }
      }

      const confirm = Array.from(panelNode.querySelectorAll('button,[role="button"],a,input[type="button"],[class*="btn" i]'))
        .filter(n => visible(n) && enabled(n) && outsideGrids(n) && CONFIRM_TEXT.test(compact(n.getAttribute('aria-label') || n.textContent))).slice(0, 2);
      const timeNodes = Array.from(panelNode.querySelectorAll('li,[role="option"],[class*="cell" i],[class*="item" i]')).filter(n => visible(n) && TIME_TEXT.test(compact(n.textContent)));
      const selectedCell = grids.flatMap(g => g.cells).find(c => c.node.getAttribute('aria-selected') === 'true' || /(^|[\s_-])(selected|current|active)([\s_-]|$)/.test(String(c.node.className || '')));

      const confidence = !cells.length || !grids.length ? null : uniquePerMode && (header.year != null || modes.length === 1) ? 'high' : 'low';
      const view = {
        panel: panelNode, grids, modes, uniquePerMode, confidence,
        header, yearButtons, monthButtons, paging: pagingOuter, confirm, timePanel: timeNodes.length >= 6,
        selected: selectedCell ? { text: selectedCell.text, attr: selectedCell.attr } : null,
        stale: () => !panelNode.isConnected,
        summary() {
          return {
            grids: grids.map(g => ({ mode: g.mode, count: g.cells.length, labels: g.cells.map(c => c.text).slice(0, MAX_CELLS_PER_GRID) })),
            header, paging: pagingOuter.map(p => ({ direction: p.direction, claim: p.claim, label: p.label })),
            confirm: confirm.map(n => compact(n.textContent).slice(0, 12)), timePanel: timeNodes.length >= 6,
            selected: selectedCell ? selectedCell.text : null, modes, uniquePerMode, confidence
          };
        },
        /* 合成契约：resolver 每次访问重新分类当前面板；字段形态与 control-catalog 契约一致。
           三种视图无条件声明（rc-picker 类面板一次只显示一种视图，切换后 resolver 自然命中），
           这样校验器要求的完整导航链在单视图面板上也成立。 */
        contract(panelGetter) {
          if (confidence !== 'high' || !uniquePerMode) return null;
          const now = () => classifyCalendar(panelGetter ? panelGetter() : panelNode);
          const containerOf = mode => () => {
            const fresh = now();
            const grids = (fresh?.grids || []).filter(g => g.mode === mode);
            return grids.length === 1 ? grids[0].container : null;
          };
          const cellsOf = mode => () => {
            const fresh = now();
            const grids = (fresh?.grids || []).filter(g => g.mode === mode);
            return grids.length === 1 ? grids[0].cells.map(c => c.node) : [];
          };
          const contract = { name: '通用日历结构分类' };
          for (const mode of ['year', 'month', 'day']) { contract[mode + 'Grid'] = containerOf(mode); contract[mode + 'Cells'] = cellsOf(mode); }
          contract.yearButton = () => (now()?.yearButtons || []).slice(0, 3);
          contract.monthButton = () => (now()?.monthButtons || []).slice(0, 3);
          const decade = direction => () => {
            const fresh = now()?.paging || [];
            const usable = fresh.filter(p => p.direction === direction || (direction === 'prev-decade' && p.direction === 'prev') || (direction === 'next-decade' && p.direction === 'next'));
            return usable.map(p => p.node);
          };
          contract.prevDecade = decade('prev-decade'); contract.nextDecade = decade('next-decade');
          contract.confirmButton = () => (now()?.confirm || []).slice(0, 2);
          if (timeNodes.length >= 6) contract.unsupported = () => (now() ? timeNodes : []).filter(n => n.isConnected && visible(n));
          return contract;
        }
      };
      return view;
    }

    /* ---------- 目标、精度与读回核对 ---------- */

    function targetParts(value) {
      const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(String(value ?? '').trim());
      return m ? { y: +m[1], m: m[2] ? +m[2] : null, d: m[3] ? +m[3] : null } : null;
    }
    function parsePageValue(text) {
      const s = String(text ?? '').trim();
      let m = /^(\d{4})[-/年](\d{1,2})(?:[-/月](\d{1,2}))?日?$/.exec(s);
      if (m) return { y: +m[1], m: +m[2], d: m[3] ? +m[3] : undefined };
      m = /^(\d{4})\s*年?$/.exec(s);
      return m ? { y: +m[1] } : null;
    }
    function valueMatches(actual, target, precision) {
      const got = parsePageValue(actual);
      if (!got || got.y !== target.y) return false;
      if (precision === 'year') return true;
      if (got.m !== target.m) return false;
      if (precision === 'month') return true;
      return got.d === target.d;
    }

    /* ---------- 候选生成：tier-1 语义动作 + tier-2 受约束通用元素 ---------- */

    function denyReason(node) {
      const exported = root.ResumeProCaptureAutoclick?.denyReason;
      if (exported) return exported(node);
      if (!node?.isConnected) return 'stale';
      if (node.matches('button[type="submit"],input[type="submit"],a[href]')) return 'denylist';
      return null;
    }
    function denyAtPoint(node) {
      const r = node.getBoundingClientRect();
      if (!r.width || !r.height) return null;
      const hit = document.elementFromPoint(Math.max(0, Math.min(innerWidth - 1, r.x + r.width / 2)), Math.max(0, Math.min(innerHeight - 1, r.y + r.height / 2)));
      return hit && hit !== node ? denyReason(hit) : null;
    }
    function tier2Elements(entry, panelNode, view) {
      const safe = view || { grids: [], yearButtons: [], monthButtons: [], paging: [], confirm: [] };
      const taken = [...safe.yearButtons, ...safe.monthButtons, ...safe.paging.map(p => p.node), ...safe.confirm, ...safe.grids.flatMap(g => g.cells.map(c => c.node))];
      return Array.from(panelNode.querySelectorAll('button,[role="button"],a,[role="gridcell"],[role="option"],td,li,[class*="cell" i],[class*="item" i],[class*="btn" i]'))
        .filter(n => visible(n) && enabled(n) && !taken.some(t => t === n || t.contains(n) || n.contains(t)))
        .filter(n => { const reason = denyReason(n); return !reason && !denyAtPoint(n); })
        .slice(0, MAX_TIER2);
    }
    // 字段附近可能打开日历的图标/按钮：点击输入框无效时的备选触发器（上限 3 个，全部过危险动作黑名单）。
    function nearbyTriggers(entry) {
      const el = entry.element;
      if (!el?.isConnected) return [];
      let scope = el.closest('label');
      if (!scope) {
        for (let node = el.parentElement, i = 0; node && node !== document.body && i < 3; i++, node = node.parentElement) {
          const found = Array.from(node.querySelectorAll('svg,[class*="icon" i],[class*="calendar" i],button,[role="button"],[aria-label]')).some(n => n !== el && !el.contains(n) && visible(n));
          if (found) { scope = node; break; }
        }
      }
      if (!scope) return [];
      return Array.from(scope.querySelectorAll('svg,[class*="icon" i],[class*="calendar" i],button,[role="button"],[aria-label]'))
        .filter(n => n !== el && !el.contains(n) && visible(n) && enabled(n) && !denyReason(n) && !denyAtPoint(n))
        .filter(n => { const r = n.getBoundingClientRect(); return r.width > 0 && r.width <= 96 && r.height <= 96; })
        .slice(0, 3);
    }
    function buildCandidates(entry, view) {
      const out = [];
      const panelNode = panelOf(entry);
      if (!panelNode) {
        // 弹层尚未归属：只提供「尝试打开」类候选；归属唯一确认之前不给任何面板内部动作。
        out.push({ id: 'open', kind: 'open', label: '点击当前日期控件尝试打开日历' });
        nearbyTriggers(entry).forEach((n, i) => out.push({ id: `open-icon-${i}`, kind: 'open-icon', index: i, label: `点击「${compact(n.getAttribute('aria-label') || n.textContent).slice(0, 12)}」尝试打开日历` }));
        const editable = entry.element instanceof HTMLInputElement && !entry.element.readOnly && !entry.element.disabled
          && !entry.element.matches('[type="checkbox"],[type="radio"],[type="date"],[type="month"]');
        if (editable && entry.targetValue) out.push({ id: 'type', kind: 'type', label: `在输入框直接输入目标日期 ${entry.targetValue}` });
        out.push({ id: 'wait', kind: 'wait', label: '等待异步渲染' }, { id: 'stop', kind: 'stop', label: '停止并交给用户' });
        return out.slice(0, 100);
      }
      const view2 = view || { grids: [], yearButtons: [], monthButtons: [], paging: [], confirm: [], confidence: null };
      // 时分面板：规则与 AI 都只支持到年月日，识别出时分即暂停，不给可点击候选。
      if (view2.timePanel) { out.push({ id: 'wait', kind: 'wait', label: '等待异步渲染' }, { id: 'stop', kind: 'stop', label: '该日历需要选择时分，已暂停' }); return out; }
      const parts = targetParts(entry.targetValue);
      view2.yearButtons.slice(0, 2).forEach((n, i) => out.push({ id: `year-view-${i}`, kind: 'open-year-view', index: i, label: `点击「${compact(n.textContent).slice(0, 12)}」打开年份选择` }));
      view2.monthButtons.slice(0, 2).forEach((n, i) => out.push({ id: `month-view-${i}`, kind: 'open-month-view', index: i, label: `点击「${compact(n.textContent).slice(0, 12)}」打开月份选择` }));
      const uniqueMatch = (grid, predicate) => {
        const matches = grid.cells.filter(predicate);
        return matches.length === 1 ? matches[0] : null;
      };
      for (const grid of view2.grids) {
        if (grid.mode === 'year' && parts?.y != null) {
          const match = uniqueMatch(grid, c => c.value === parts.y || c.attr?.y === parts.y);
          if (match) out.push({ id: 'pick-year', kind: 'choose-year', grid: grid.mode, match: { y: parts.y }, label: `选择年份 ${parts.y}` });
        }
        if (grid.mode === 'month' && parts?.m != null) {
          const match = uniqueMatch(grid, c => c.value === parts.m || (c.attr?.y === parts.y && c.attr?.m === parts.m));
          if (match) out.push({ id: 'pick-month', kind: 'choose-month', grid: grid.mode, match: { y: parts?.y, m: parts.m }, label: `选择月份 ${parts.m}` });
        }
        if (grid.mode === 'day' && parts?.d != null) {
          const match = uniqueMatch(grid, c => c.attr?.y === parts.y && c.attr?.m === parts.m && c.attr?.d === parts.d
            || c.value === parts.d && !c.attr);
          if (match) out.push({ id: 'pick-day', kind: 'choose-day', grid: grid.mode, match: { y: parts.y, m: parts.m, d: parts.d }, label: `选择日期 ${parts.y}-${String(parts.m).padStart(2, '0')}-${String(parts.d).padStart(2, '0')}` });
        }
      }
      view2.paging.forEach((p, i) => out.push({ id: `nav-${p.direction}-${i}`, kind: 'nav', index: i, direction: p.direction, label: `点击翻页「${p.label || p.direction}」（点击后需按方向核对）` }));
      if (view2.confirm.length === 1) out.push({ id: 'confirm', kind: 'confirm', label: '点击日历的确认按钮' });
      const editable = entry.element instanceof HTMLInputElement && !entry.element.readOnly && !entry.element.disabled
        && !entry.element.matches('[type="checkbox"],[type="radio"],[type="date"],[type="month"]');
      if (editable) out.push({ id: 'type', kind: 'type', label: `在输入框直接输入目标日期 ${entry.targetValue}` });
      // tier-2 兜底：分类置信度低，或表头没有任何可导航按钮（执行器不能让 AI 无路可走）。
      if (view2.confidence !== 'high' || (!view2.yearButtons.length && !view2.monthButtons.length && view2.grids.length)) {
        tier2Elements(entry, panelNode, view).forEach((n, i) => out.push({
          id: `element-${i}`, kind: 'click-element', index: i,
          label: `点击面板内显示为「${compact(n.textContent).slice(0, 12)}」的可交互元素`
        }));
      }
      out.push({ id: 'wait', kind: 'wait', label: '等待异步渲染' });
      out.push({ id: 'stop', kind: 'stop', label: '停止并交给用户' });
      return out.slice(0, 100);
    }
    function resolveCell(entry, gridMode, match) {
      const view = classifyCalendar(panelOf(entry));
      const grid = view?.grids.find(g => g.mode === gridMode);
      if (!grid) return null;
      const matches = grid.cells.filter(c =>
        match.d != null ? (c.attr?.y === match.y && c.attr?.m === match.m && c.attr?.d === match.d || c.value === match.d && !c.attr)
          : match.m != null ? (c.value === match.m || c.attr?.y === match.y && c.attr?.m === match.m)
            : c.value === match.y || c.attr?.y === match.y);
      return matches.length === 1 ? matches[0].node : null;
    }

    /* ---------- 精度惰性解析：弹层未归属时也能先进入 AI 打开阶段 ---------- */

    function ensurePrecision(entry, value) {
      if (entry.precisionState) return entry.precisionState;
      const panelNode = panelOf(entry);
      const view = panelNode ? classifyCalendar(panelNode) : null;
      const resolved = root.ResumeProDatePrecision.resolve({ element: entry.element, calendar: { grids: view?.modes || [] } });
      entry.precisionEvidence = resolved.evidence;
      if (!resolved.precision) return null;
      let targetValue, padded;
      if (resolved.precision === 'year') {
        targetValue = String((/^(\d{4})/.exec(String(value ?? '').trim()) || [])[1] || '');
        padded = false;
      } else {
        const normalized = root.ResumeProAIHelpers.normalizeDateForPrecision(value, resolved.precision);
        targetValue = normalized.value; padded = Boolean(normalized.padded);
      }
      entry.precisionState = { precision: resolved.precision, targetValue, padded };
      entry.targetValue = targetValue; entry.padded = padded;
      return entry.precisionState;
    }
    // 动作反馈：before/after 全部来自真实页面观察，模型据此区分「点击成功且页面变化」「点击无效」「方向不符」。
    function captureState(entry) {
      const panelNode = panelOf(entry);
      const view = panelNode ? classifyCalendar(panelNode) : null;
      return { value: String(read(entry) || ''), view: view ? { modes: view.modes, header: view.header } : null };
    }
    function diffState(entry, before) {
      const after = captureState(entry);
      const changed = after.value !== before.value || JSON.stringify(after.view) !== JSON.stringify(before.view);
      return { before, after, outcome: changed ? 'PAGE_CHANGED' : 'NO_CHANGE' };
    }

    /* ---------- 逐步 AI 循环（观察 → 模型选 id → 执行 → 重观察） ---------- */

    async function runLoop(entry, { start }) {
      const states0 = { lastAction: '尚未操作', stalls: 0, previous: '' };
      const observe = () => {
        if (Date.now() - start > BUDGET_MS) return { blocked: '日期交互时间达到上限' };
        if (!entry.element?.isConnected) {
          const fresh = refresh?.(entry);
          if (!fresh?.element?.isConnected) return { blocked: '日期输入框已被替换，不能唯一定位' };
          entry.element = fresh.element; entry.trigger = entry.element; entry.root = entry.element;
        }
        if (entry.peerBefore !== undefined && peerValue?.(entry) !== entry.peerBefore) return { blocked: '另一端日期被改变，已停止' };
        const panelNode = panelOf(entry);
        const view = panelNode ? classifyCalendar(panelNode) : null;
        // 弹层已归属但精度无法从页面证据确定：保守停止，不按资料日期猜。
        const state = panelNode ? ensurePrecision(entry, entry.rawValue) : null;
        if (panelNode && !state) return { blocked: '无法从页面证据确定日期精度，未按资料日期猜测' };
        const current = String(read(entry) || '').trim();
        const candidates = buildCandidates(entry, view);
        const fingerprint = JSON.stringify([Boolean(panelNode), view?.summary(), current, candidates.map(c => c.id)]);
        states0.stalls = fingerprint === states0.previous ? states0.stalls + 1 : 0;
        states0.previous = fingerprint;
        if (states0.stalls >= STALL_LIMIT) return { blocked: '日历操作没有推进，停止重复点击' };
        entry.lastView = view;
        // 只发送日期导航需要的字段，其余个人信息不出观察负载。
        const fieldSlim = entry.meta ? (({ label, inputType, datePart, rangeRole, recordIndex, recordTotal }) => ({ label, inputType, datePart, rangeRole, recordIndex, recordTotal }))(entry.meta) : null;
        return {
          field: fieldSlim, target: entry.targetValue || null, precision: entry.precisionState?.precision || null,
          precisionEvidence: entry.precisionEvidence, current, panel: view ? view.summary() : null,
          lastAction: states0.lastAction, candidates, fingerprint
        };
      };
      const execute = async action => {
        const before = captureState(entry);
        let intent = action.kind;
        if (action.kind === 'open') {
          intent = '点击日期控件';
          if (!panelOf(entry)) { popup.transition(entry, states.SELECTING); await click(entry.trigger); await until(() => panelOf(entry), 1500); }
        } else if (action.kind === 'open-icon') {
          const icons = nearbyTriggers(entry);
          const node = icons[action.index];
          if (!node?.isConnected || !visible(node) || !enabled(node)) throw new Error('日历图标已失效');
          const denied = denyReason(node) || denyAtPoint(node);
          if (denied) throw new Error(`日历图标未通过安全检查（${denied}）`);
          intent = `点击「${compact(node.getAttribute('aria-label') || node.textContent).slice(0, 12)}」打开日历`;
          popup.transition(entry, states.SELECTING);
          if (await click(node) === false) throw new Error('点击日历图标失败');
          await until(() => panelOf(entry), 1500);
        } else if (action.kind === 'wait') {
          intent = '等待异步渲染';
          await wait(600);
        } else if (action.kind === 'stop') {
          // 无操作，由 verify/收尾处理。
        } else if (action.kind === 'type') {
          // 直接输入不依赖弹层节点：只验证输入框本身可编辑、未被替换；readonly 一律拒绝。
          const el = entry.element;
          if (!el?.isConnected || el.readOnly || el.disabled || el.matches('[type="checkbox"],[type="radio"],[type="date"],[type="month"]')) throw new Error('输入框不可编辑，不能直接输入日期');
          if (!input) throw new Error('当前没有可用的文本输入通道');
          intent = '直接输入目标日期';
          popup.transition(entry, states.SELECTING);
          await input(el, entry.targetValue);
        } else {
          const panelNode = panelOf(entry);
          if (!panelNode) throw new Error('弹层未打开，无法执行日期操作');
          popup.transition(entry, states.SELECTING);
          let node = null, expect = '';
          if (action.kind === 'choose-year') { node = resolveCell(entry, 'year', action.match); expect = `年份 ${action.match.y}`; }
          else if (action.kind === 'choose-month') { node = resolveCell(entry, 'month', action.match); expect = `月份 ${action.match.m}`; }
          else if (action.kind === 'choose-day') { node = resolveCell(entry, 'day', action.match); expect = `日期 ${action.match.d}`; }
          else if (action.kind === 'open-year-view') { node = classifyCalendar(panelNode)?.yearButtons?.[action.index] || null; expect = '年份标题'; }
          else if (action.kind === 'open-month-view') { node = classifyCalendar(panelNode)?.monthButtons?.[action.index] || null; expect = '月份标题'; }
          else if (action.kind === 'nav') { node = classifyCalendar(panelNode)?.paging?.[action.index]?.node || null; expect = action.direction; }
          else if (action.kind === 'confirm') { node = classifyCalendar(panelNode)?.confirm?.[0] || null; expect = '确认按钮'; }
          else if (action.kind === 'click-element') { node = tier2Elements(entry, panelNode, entry.lastView)[action.index] || null; expect = '面板元素'; }
          else throw new Error('未知动作类型');
          if (!node || !node.isConnected || !visible(node) || !enabled(node)) throw new Error(`候选元素已失效：${expect}`);
          const denied = denyReason(node) || denyAtPoint(node);
          if (denied) throw new Error(`候选元素未通过安全检查（${denied}）`);
          intent = expect;
          if (await click(node) === false) throw new Error(`点击失败：${expect}`);
          // 翻页方向核对：声称的方向未让面板前进时记入动作反馈，由模型下次决定或停止。
          if (action.kind === 'nav') {
            await wait(180);
            const fresh = classifyCalendar(panelOf(entry));
            if (fresh && before.view && before.view.header.year != null && fresh.header.year != null) {
              if (/prev/.test(action.direction) && fresh.header.year > before.view.header.year
                || /next/.test(action.direction) && fresh.header.year < before.view.header.year) intent += '（方向与声称不符）';
            }
          }
        }
        states0.lastAction = { kind: action.kind, intent, ...diffState(entry, before) };
      };
      const verify = async () => {
        popup.transition(entry, states.VERIFYING);
        const state = entry.precisionState;
        const ok = state ? valueMatches(String(read(entry) || ''), targetParts(state.targetValue), state.precision) : false;
        popup.transition(entry, states.OPEN);
        return ok;
      };
      return root.ResumeProInteractionAgent.run({
        observe, decide: entry.decide, execute, verify,
        maxSteps: MAX_ACTIONS,
        trace: (action, detail) => trace(entry, action, detail)
      });
    }

    /* ---------- 收尾：关面板 → 读回 → 精度形态核对 → peer 保护 ---------- */

    function finalize(entry, { target, precision, peerBefore }) {
      const actual = String(read(entry) || '').trim();
      if (!valueMatches(actual, targetParts(target), precision)) return { ok: false, value: target, reason: '页面未保留目标日期' };
      const shape = root.ResumeProDatePrecision.precisionOfValue(actual);
      if (shape !== precision) return { ok: false, value: target, reason: '页面提交值形态与识别精度不一致' };
      if (peerBefore !== undefined && peerValue?.(entry) !== peerBefore) return { ok: false, value: target, reason: '另一端日期被改变，已停止' };
      return { ok: true, value: target, padded: entry.padded || false };
    }

    /* ---------- 接管前状态检查：适配器失败不等于页面回到原状 ---------- */

    function anchoredTo(entry, node) {
      const a = entry.element.getBoundingClientRect(), b = node.getBoundingClientRect();
      const gap = Math.min(Math.abs(b.top - a.bottom), Math.abs(a.top - b.bottom));
      return b.right >= a.left - 24 && b.left <= a.right + 24 && gap <= Math.max(96, a.height * 2);
    }
    function inspectHandoff(entry, { peerBefore } = {}) {
      entry.trigger = entry.element; entry.root = entry.element;
      const observed = popup.inspect(entry);
      let panelNode = observed.panel;
      if (!panelNode) {
        // 适配器留下的无 ARIA 弹层：按几何锚定唯一归属，找不到就不猜。
        const near = popup.candidates().filter(n => visible(n) && !n.contains(entry.element) && anchoredTo(entry, n));
        panelNode = near.length === 1 ? near[0] : null;
        if (near.length > 1) return { safe: false, code: 'HANDOFF_UNSAFE', panel: null };
      }
      if (peerBefore !== undefined && peerValue && peerValue(entry) !== peerBefore) return { safe: false, code: 'PEER_CHANGED', panel: panelNode };
      const modal = Array.from(document.querySelectorAll('[aria-modal="true"]')).find(popup.painted);
      if (modal && modal !== panelNode && !(panelNode && panelNode.contains(modal))) return { safe: false, code: 'HANDOFF_UNSAFE', panel: panelNode };
      return { safe: true, panel: panelNode && visible(panelNode) ? panelNode : null, expanded: observed.expanded };
    }

    /* ---------- 入口 ---------- */

    async function fill(entry, value, precision, handoff) {
      entry.interactions = [];
      entry.rawValue = value;
      entry.precisionState = null;
      const start = Date.now();
      try {
        if (entry.element?.matches?.('[type="checkbox"],[type="radio"]')) return { ok: false, status: 'SKIPPED', code: '', value, reason: '勾选控件不能按日期填写' };
        // 接管前的 peer 基线来自路由（适配器尝试之前），适配器改坏的另一端不会被当成基线。
        entry.peerBefore = handoff?.peerBefore !== undefined ? handoff.peerBefore : (peerValue ? peerValue(entry) : undefined);
        let panelNode = handoff?.panel || await openPanel(entry);
        if (panelNode && handoff?.panel) {
          // 脏状态接管的弹层没有经过 openPanel：补上 adopt 纪律，否则 popup 状态停在
          // CLOSED，panelOf 解析为 null，execute 的状态转换也会抛异常。
          adopt(entry, panelNode);
        }
        if (panelNode) {
          const view = classifyCalendar(panelNode);
          const state = ensurePrecision(entry, value);
          trace(entry, '识别日历', `精度 ${state?.precision || '未定'}；视图 ${(view?.modes || []).join('/') || '未分类'}`);
          if (!state) {
            await closePanel(entry);
            return { ok: false, status: 'FAILED', code: 'PRECISION_UNRESOLVED', value, reason: '无法从页面证据确定日期精度，未按资料日期猜测' };
          }
          if (!targetParts(entry.targetValue)) {
            await closePanel(entry);
            return { ok: false, status: 'FAILED', code: '', value, reason: '目标日期格式不明确' };
          }
          // 快路径：结构高置信 → 合成契约交给 CalendarAgent，0 次模型调用。基准 C 组用开关关掉它。
          if (!root.__APPLY_FILL_DATE_DISABLE_CONTRACT__ && view?.confidence === 'high' && view.uniquePerMode) {
            const contract = view.contract(() => panelOf(entry));
            if (contract) {
              const agent = root.ResumeProCalendarAgent.create({ visible, click });
              const result = await agent.fill({
                entry: { fillNote: '' }, value: entry.targetValue, precision: state.precision,
                panel: () => panelOf(entry), read: () => read(entry),
                close: async () => { await closePanel(entry); },
                trace: (a, d) => trace(entry, `规则驱动·${a}`, d),
                readPeer: () => (peerValue ? peerValue(entry) : undefined), contract
              });
              if (result?.ok) {
                // 与 ud 的最严成功语义一致：值读回通过还不够，弹层必须真的收起。
                const closed = await closePanel(entry);
                if (!closed) return { ok: false, status: 'BLOCKED', code: 'POPUP_CLOSE_UNCONFIRMED', value, reason: '日历未关闭，已暂停后续填写' };
                const final = finalize(entry, { target: entry.targetValue, precision: state.precision, peerBefore: entry.peerBefore });
                if (final.ok) { trace(entry, '核对', '通用规则驱动完成并读回通过'); return { ...final, status: 'SUCCESS', code: 'VALUE_VERIFIED', via: 'contract' }; }
              } else if (result) {
                trace(entry, '规则驱动未完成', result.reason || '');
              }
            }
          }
        } else {
          // 弹层未归属：先用静态证据（占位符/控件类型）尝试定精度，type 候选才有目标值；
          // 静态也定不了就留给循环——打开类候选不需要精度，归属后再按结构证据重解析。
          ensurePrecision(entry, value);
          if (!entry.decide) {
            // 归属失败且没有 AI 决策器：维持 0.8.21 的失败语义。
            const blocked = Boolean(entry.popupBlocked || entry.panelAmbiguous);
            return { ok: false, status: blocked ? 'BLOCKED' : 'FAILED', code: blocked ? 'POPUP_OWNERSHIP_UNCONFIRMED' : '', value, reason: entry.fillNote || '未出现可识别的关联日历' };
          }
        }
        // AI 逐步接管：模型每次从最新观察的候选里选一个 id。
        // 弹层尚未归属时 observe 只给「尝试打开」类候选（点击输入框/日历图标/等待），
        // 归属唯一确认之前不会出现任何面板内部动作。
        if (!entry.decide) {
          const closed = await closePanel(entry);
          if (!closed) return { ok: false, status: 'BLOCKED', code: 'POPUP_CLOSE_UNCONFIRMED', value, reason: '日历未关闭，已暂停后续填写' };
          return { ok: false, status: 'FAILED', code: '', value, reason: '通用结构未能规则驱动，且 AI 交互不可用' };
        }
        const completed = await runLoop(entry, { start });
        const closed = await closePanel(entry);
        if (!closed) return { ok: false, status: 'BLOCKED', code: 'POPUP_CLOSE_UNCONFIRMED', value, reason: '日历未关闭，已暂停后续填写' };
        const state = entry.precisionState;
        if (!completed || !state) {
          return {
            ok: false, status: 'FAILED',
            code: !state ? 'PRECISION_UNRESOLVED' : 'VALUE_UNCONFIRMED',
            value, reason: !state ? '无法从页面证据确定日期精度，未按资料日期猜测' : (entry.fillNote || 'AI 未确认结果')
          };
        }
        const final = finalize(entry, { target: state.targetValue, precision: state.precision, peerBefore: entry.peerBefore });
        if (!final.ok) return { ok: false, status: 'FAILED', code: 'VALUE_UNCONFIRMED', value, reason: final.reason };
        trace(entry, '核对', 'AI 逐步交互完成并读回通过');
        return { ...final, status: 'SUCCESS', code: 'VALUE_VERIFIED', via: 'ai-loop' };
      } catch (error) {
        await closePanel(entry).catch(() => {});
        const blocked = Boolean(entry.popupBlocked);
        return { ok: false, status: blocked ? 'BLOCKED' : 'FAILED', code: entry.failureCode || '', value, reason: error.message };
      }
    }

    return { fill, inspectHandoff, classifyCalendar };
  }
  root.ResumeProGenericDateAgent = { create };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.ResumeProGenericDateAgent;
})(typeof self !== 'undefined' ? self : globalThis);
