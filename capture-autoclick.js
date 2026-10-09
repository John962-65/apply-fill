/* 自动点击采集：把没填上的控件挨个点开，快照仍交给 control-capture 记（脱敏、节点上限、导出格式都在那边）。
   只点触发器、只开不选、全程不输入文本。疑似提交/跳转/删除/协议勾选的控件一律跳过，并把跳过原因写进导出文件。 */
(() => {
  'use strict';
  // 7 个目标 × 3 张快照 = 21，给 recorder 的 24 格上限留出「导出前」和意外快照的位置。
  const MAX_TARGETS = 7;
  const BUDGET_MS = 90000;   // 循环自己的硬预算；会话死线另由 recorder 管（自动模式 120 秒）
  const SESSION_MS = 120000;
  const SETTLE_MS = 1400;    // 等弹层出现，对齐 combo-agent until() 的默认值
  const QUIET_MS = 400;      // 没有新弹层时的静默等待
  const CLOSE_MS = 1200;
  const DANGER_TEXT = /^(提交|保存|下一步|上一步|投递|确认|发送|删除|清空|移除|重置|取消|放弃|撤回|退出|登录|注册|授权|同意|submit|save|next|previous|delete|remove|clear|reset|cancel|send|sign ?in|log ?(in|out)|apply now)/i;
  const CONSENT_TEXT = /同意|协议|承诺/;
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  // 80ms 轮询，和 combo-agent 的 until 一致（那边没导出，只能自带一份）。
  async function until(predicate, ms) {
    const end = Date.now() + ms;
    do { const value = predicate(); if (value) return value; await wait(80); } while (Date.now() < end);
    return null;
  }
  const label = n => String(n?.textContent || n?.getAttribute?.('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 40);

  // 只用于 button / a / [role="button"] 这类可执行动作的节点：
  // 字段名和 placeholder 里出现「提交日期」是正常的，不能拿这套词表去判它们。
  function dangerousText(value) {
    return DANGER_TEXT.test(String(value || '').replace(/\s+/g, ' ').trim().slice(0, 40));
  }

  function denyReason(node) {
    if (!node?.isConnected) return 'stale';
    if (node.matches('input[type="checkbox"],input[type="radio"]')) return 'would-modify-data';
    if (node.matches('button[type="submit"],input[type="submit"],input[type="image"]')) return 'denylist';
    if (node.matches('a[href]') && !/^(#|javascript:)/i.test(node.getAttribute('href') || '')) return 'denylist';
    if (node.matches('button,a,[role="button"]') && (dangerousText(label(node)) || dangerousText(node.getAttribute('placeholder')))) return 'denylist';
    if (CONSENT_TEXT.test(node.closest?.('label')?.textContent || '')) return 'would-modify-data';
    return null;
  }

  // CDP 点在元素矩形正中心，而中心上盖着的可能是控件自带的「清空」按钮：
  // 真正被点的是命中的那个节点，所以要按命中点再判一次，不能只看目标本身。
  function denyAtPoint(node) {
    const r = node.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    const hit = document.elementFromPoint(Math.max(0, Math.min(innerWidth - 1, r.x + r.width / 2)), Math.max(0, Math.min(innerHeight - 1, r.y + r.height / 2)));
    return hit && hit !== node ? denyReason(hit) : null;
  }

  // 长表单里目标常在几千像素之下，而 browser-input 的点击坐标是 scrollIntoView 之后立刻读的：
  // 页面还在滚，坐标就是废的，点下去落在空处（真实采集文件里 y=5659 的获奖时间控件点了没反应、
  // 焦点都没动，就是这么来的）。按节点自身 rect 判断停稳，内层滚动容器也算。
  async function settleScroll(node) {
    node.scrollIntoView({ block: 'center', inline: 'nearest' });
    let previous = null;
    let stable = 0;
    for (let i = 0; i < 14; i += 1) {
      await wait(70);
      const top = Math.round(node.getBoundingClientRect().top);
      if (top === previous) { if (++stable >= 2) return; } else { stable = 0; previous = top; }
    }
  }

  const inViewport = (node) => {
    const r = node.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.top >= -1 && r.bottom <= innerHeight + 1;
  };

  function create({ recorder, click, escape, visible, getTargets, onStatus = () => {} }) {
    let running = false;

    const skippedOf = (target, skip, detail) => {
      const item = { reason: target.reason, control: target.control, skip };
      if (target.labelSafe && target.label) item.label = target.label;
      if (target.hint) item.hint = target.hint;
      if (detail) item.detail = detail;
      return item;
    };

    async function run() {
      if (running) return { started: false, skip: 'running' };
      const all = (getTargets?.() || []).filter(item => item?.node);
      if (!all.length) {
        onStatus('没有可自动点击的控件：先在这个页面跑一次填写，或改用手动采集。');
        return { started: false, skip: 'no-targets' };
      }
      running = true;
      const denied=all.filter(target=>denyReason(target.node));
      const eligible=all.filter(target=>!denied.includes(target));
      const planned = self.ResumeProControlCatalog?.sampleTargets(eligible,MAX_TARGETS)||eligible.slice(0, MAX_TARGETS);
      const skipped = [...denied.map(target=>skippedOf(target,denyReason(target.node))),
        ...eligible.filter(target=>!planned.includes(target)).map(target=>skippedOf(target,'budget'))];
      const kinds = new Set();
      let clicked = 0;
      let panelsOpened = 0;
      const startedAt = Date.now();
      const summarize = () => ({
        startedAt,
        source: all[0].source || 'page-scan',
        clickKind: kinds.size > 1 ? 'mixed' : [...kinds][0] || 'none',
        targetsPlanned: planned.length,
        targetsClicked: clicked,
        // 点到了但面板没打开，是「这个组件不认这种点击」的直接证据，要和点击数分开记。
        panelsOpened,
        targetsSkipped: skipped
      });
      if (!recorder.active) recorder.start({ deadlineMs: SESSION_MS });
      recorder.setAuto(true);
      recorder.setAutoClick(summarize());
      try {
        for (let index = 0; index < planned.length; index += 1) {
          const target = planned[index];
          if (!recorder.active) { skipped.push(skippedOf(target, 'session-ended')); continue; }
          if (Date.now() - startedAt > BUDGET_MS) {
            for (const rest of planned.slice(index)) skipped.push(skippedOf(rest, 'budget'));
            break;
          }
          const node = target.node;
          if (!node.isConnected) { skipped.push(skippedOf(target, 'stale')); continue; }
          if (visible && !visible(node)) { skipped.push(skippedOf(target, 'hidden')); continue; }
          // 先滚到位再判中心点命中：离屏元素的中心坐标会被钳到视口边缘，命中检查等于没做。
          await settleScroll(node);
          if (!inViewport(node)) { skipped.push(skippedOf(target, 'offscreen')); continue; }
          const deny = denyReason(node) || denyAtPoint(node);
          if (deny) { skipped.push(skippedOf(target, deny)); continue; }
          const meta = { index, control: target.control, reason: target.reason };
          const before = new Set(recorder.panels());
          if (!recorder.arm(node, meta)) { skipped.push(skippedOf(target, 'no-root')); continue; }
          let kind = 'synthetic';
          try {
            kind = (await click(node)) || 'synthetic';
          } catch (error) {
            skipped.push(skippedOf(target, 'click-failed', String(error?.message || error).slice(0, 80)));
            continue;
          }
          kinds.add(kind);
          clicked += 1;
          meta.clickKind = kind;
          // 弹层出现就立刻往下走；没出现也等一小段静默期，好让「点了没反应」这件事被如实记下来。
          const opened = Boolean(await until(() => recorder.panels().some(panel => !before.has(panel)), SETTLE_MS));
          if (!opened) await wait(QUIET_MS);
          meta.opened = opened;
          meta.focusInside = node === document.activeElement || node.contains(document.activeElement);
          if (opened) panelsOpened += 1;
          await wait(350);
          recorder.capture('自动点击后 350ms', meta);
          await wait(950);
          recorder.capture('自动点击后 1300ms', meta);
          await closePanel(node);
          // 弹层关不掉就记一笔继续：残留的浮层会让后面的目标被遮挡检查拒掉，这个信息本身就是诊断结果。
          if (!await until(() => recorder.panels().every(panel => before.has(panel)), CLOSE_MS)) skipped.push(skippedOf(target, 'panel-stuck'));
          onStatus(`自动采集 ${index + 1}/${planned.length}：已点击 ${clicked} 个（打开面板 ${panelsOpened} 个），跳过 ${skipped.length} 个。`);
        }
      } finally {
        recorder.setAuto(false);
        recorder.setAutoClick(summarize());
        running = false;
        const danger = skipped.filter(item => item.skip === 'denylist' || item.skip === 'would-modify-data').length;
        onStatus(`自动采集完成：点击 ${clicked} 个，打开面板 ${panelsOpened} 个，跳过 ${skipped.length} 个${danger ? `（其中 ${danger} 个疑似提交/删除/协议控件，未点击）` : ''}。点“完成并导出诊断文件”。`);
      }
      return { started: true, clicked, panelsOpened, skipped: skipped.length };
    }

    // 关弹层：Escape → 失焦 → 点外面。飞书的树形下拉只发 Escape 关不掉，
    // 填写路径关日历用的也是 Escape + blur（见 writeCalendarPanelDate 的 close）。
    async function closePanel(node) {
      const delegated=escape?.(node);
      if(delegated){try{await delegated;}catch{}}
      else{
        const event = () => new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true });
        node.dispatchEvent?.(event());document.activeElement?.dispatchEvent?.(event());
      }
      node.blur?.();
      document.activeElement?.blur?.();
      if (recorder.panels().length) document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    }

    return { run, get running() { return running; } };
  }

  self.ResumeProCaptureAutoclick = { create, denyReason, dangerousText, MAX_TARGETS, BUDGET_MS, SESSION_MS };
})();
