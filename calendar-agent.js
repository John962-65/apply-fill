/* Navigate only the uniquely owned popup. Re-observe after every action. */
(function (root) {
  'use strict';
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const compact = value => String(value ?? '').replace(/\s+/g, '').trim();
  const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  const fullMonths = ['january','february','march','april','may','june','july','august','september','october','november','december'];
  const chinese = ['一','二','三','四','五','六','七','八','九','十','十一','十二'];
  function monthNumber(value) {
    const text = compact(value).toLowerCase();
    const numeric = /^(\d{1,2})(?:月)?$/.exec(text);
    if (numeric) return Number(numeric[1]);
    const cn = chinese.indexOf(text.replace(/月$/, ''));
    if (cn >= 0) return cn + 1;
    const enText=text.replace(/\.$/, '');
    const en = months.includes(enText)?months.indexOf(enText):fullMonths.indexOf(enText);
    return en < 0 ? null : en + 1;
  }
  function create(config) {
    const {visible,click} = config;
    const query = (node, selector) => Array.from(node?.querySelectorAll(selector) || []).filter(visible);
    const enabled = node => node && !node.closest('[disabled],[aria-disabled="true"],[class*="-disabled"],.disabled');
    // 契约字段双形态：CSS 选择器字符串（目录契约），或 resolver 函数（动态契约，每次访问对当前作用域重新解析，不缓存节点）。
    // inner 的作用域是格子本身，其余字段的作用域是面板或当前网格。
    function resolveSpec(field, scope) {
      if (!field) return [];
      if (typeof field === 'function') {
        try { return Array.from(field(scope) || []).filter(visible); } catch { return []; }
      }
      return query(scope, field);
    }
    function recipe(panel) {
      return root.ResumeProControlCatalog.contracts.filter(c => c.calendar && (panel?.matches(c.calendar.panel) || panel?.querySelector(c.calendar.panel)));
    }
    async function fill({entry,value,precision,panel:current,read,close,trace,readPeer,contract}) {
      const found = contract
        ? (validateContract(contract) ? [{name: contract.name || '动态合成日历契约', calendar: contract}] : null)
        : recipe(current());
      if (!found || !found.length) return null;
      let target = {value:String(value),padded:false};
      const fail = reason => {entry.fillNote=reason;trace('日历停止',reason);return {ok:false,value:target.value,padded:target.padded,reason};};
      if (found.length !== 1) return fail('同时出现多种日历结构，未猜测');
      const spec = found[0].calendar;
      const innerOf = cell => {
        if (!spec.inner) return cell;
        if (typeof spec.inner === 'function') { try { return spec.inner(cell) || cell; } catch { return cell; } }
        return cell.querySelector(spec.inner) || cell;
      };
      if (spec.unsupported && resolveSpec(spec.unsupported,current()).length) return fail('该日历还需要选择时分，当前驱动只支持年月日');
      function observe() {
        const panel = current();
        if (!panel) return null;
        const grids = ['year','month','day'].flatMap(mode => resolveSpec(spec[mode+'Grid'],panel).map(grid => ({mode,grid,panel})));
        return grids.length === 1 ? grids[0] : null;
      }
      const first = observe();
      if (!first) return fail('日历存在多个日期表或未识别的视图，需采集实际结构');
      const targetPrecision = precision === 'auto' ? first.mode : precision;
      target = root.ResumeProAIHelpers.normalizeDateForPrecision(value,targetPrecision);
      if (targetPrecision === 'year') target={value:/^(\d{4})(?:$|[-/年])/.exec(String(value))?.[1] || '',padded:false};
      const parts = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(target.value);
      if (!parts) return fail('目标日期格式不明确');
      const yy=Number(parts[1]),mm=Number(parts[2]),dd=Number(parts[3]);
      if (targetPrecision !== 'year' && (!mm || mm>12 || (targetPrecision==='day' && (!dd || dd>new Date(yy,mm,0).getDate())))) return fail('目标日期缺少有效年月日');
      const normalize = v => root.ResumeProAIHelpers.normalizeDateValue(v,'date');
      // rc-picker shows a preview while changing year/month. It is not a committed value.
      let selectedFinalCell=false;
      let requiresConfirm=resolveSpec(spec.confirmButton,current()).length>0,confirmed=false;
      const same = () => selectedFinalCell && (!requiresConfirm || confirmed) && normalize(read())===target.value;
      const peerBefore = readPeer?.();
      const peerChanged = () => peerBefore !== undefined && readPeer?.() !== peerBefore;
      const until = async predicate => {for(let i=0;i<20;i++){if(predicate())return true;await wait(80);}return false;};
      const labels = s => resolveSpec(spec.yearButton,s.panel);
      const yearLabel = s => labels(s).filter(n=>/\d{4}/.test(n.textContent));
      const monthLabel = s => resolveSpec(spec.monthButton,s.panel).filter(n=>! /\d{4}/.test(n.textContent)&&monthNumber(n.textContent));
      const fingerprint = s => s ? JSON.stringify([s.mode,resolveSpec(spec.header,s.panel).map(n=>compact(n.textContent)),resolveSpec(spec[s.mode+'Cells'],s.grid).map(n=>[compact(n.textContent),n.className])]) : '';
      async function act(node,detail) {
        if (!enabled(node) || !visible(node)) return false;
        const before=fingerprint(observe());
        const done=await click(node);
        if(done===false)return false;
        trace('日历操作',detail);
        const changed=await until(()=>same()||peerChanged()||fingerprint(observe())!==before || (selectedFinalCell && requiresConfirm && normalize(read())===target.value));
        return changed;
      }
      trace('识别日历',found[0].name);
      const start=Date.now();
      for(let step=0;step<45&&Date.now()-start<20000;step++) {
        if(peerChanged())return fail('操作后另一端日期被改变，已停止');
        if(selectedFinalCell && !confirmed) {
          const buttons=resolveSpec(spec.confirmButton,current());
          if(buttons.length)requiresConfirm=true;
          if(requiresConfirm) {
            const usable=buttons.filter(enabled);
            if(usable.length!==1)return fail('日期需要确认，但没有唯一可用的确定按钮');
            confirmed=true;
            if(!await act(usable[0],'确认当前日历的日期选择'))return fail('确认日期后页面未保留目标值');
          }
        }
        if(same()) {
          close();await wait(220);
          if(peerChanged())return fail('关闭日历后另一端日期被改变，已停止');
          if(!same())return fail('选中后页面又清空或改写了日期');
          entry.fillNote='';trace('日历核对','关闭面板后目标值仍保留');
          return {ok:true,value:target.value,padded:target.padded};
        }
        // Some controlled components close first and commit their state on the next tick.
        if(!current()){await until(()=>same()||peerChanged());if(same()||peerChanged())continue;}
        const state=observe();
        if(!state)return fail('日历关闭、出现多个日期表或失去关联');
        const cells=resolveSpec(spec[state.mode+'Cells'],state.grid).filter(enabled);
        if(state.mode==='year') {
          const candidates=cells.filter(n=>compact(n.textContent)===String(yy));
          if(candidates.length>1)return fail('年份候选不唯一');
          if(candidates.length===1) {
            const node=innerOf(candidates[0]);
            if(targetPrecision==='year')selectedFinalCell=true;
            if(!await act(node,'选择有来源的年份'))return fail('选择年份后视图和值都未改变');
            continue;
          }
          const years=cells.map(n=>Number(compact(n.textContent))).filter(n=>n>=1000&&n<=9999);
          if(!years.length)return fail('无法读取当前年份范围');
          if(yy>=Math.min(...years)&&yy<=Math.max(...years))return fail('目标年份被禁用或候选缺失');
          const direction=yy<Math.min(...years)?'prevDecade':'nextDecade';
          const buttons=resolveSpec(spec[direction],state.panel).filter(enabled);
          if(buttons.length!==1||!await act(buttons[0],'切换年份范围'))return fail('年份翻页无效或按钮不唯一');
          continue;
        }
        const yearNodes=yearLabel(state);
        if(yearNodes.length!==1)return fail('当前年份无法唯一确认');
        const shownYear=Number(yearNodes[0].textContent.match(/\d{4}/)[0]);
        if(shownYear!==yy||targetPrecision==='year') {
          if(!await act(yearNodes[0],'打开年份选择'))return fail('无法打开年份视图');
          continue;
        }
        if(state.mode==='month') {
          const candidates=cells.filter(n=>monthNumber(n.textContent)===mm);
          if(candidates.length!==1)return fail('目标月份被禁用或无法唯一确认');
          const node=innerOf(candidates[0]);
          if(targetPrecision==='month')selectedFinalCell=true;
          if(!await act(node,'选择有来源的月份'))return fail('选择月份后视图和值都未改变');
          continue;
        }
        const monthNodes=monthLabel(state);
        if(monthNodes.length!==1)return fail('当前月份无法唯一确认');
        const shownMonth=monthNumber(monthNodes[0].textContent);
        if(shownMonth!==mm||targetPrecision==='month') {
          if(!await act(monthNodes[0],'打开月份选择'))return fail('无法打开月份视图');
          continue;
        }
        const candidates=cells.filter(n=>compact(n.textContent)===String(dd));
        if(candidates.length!==1)return fail('目标日期被禁用或无法唯一确认');
        selectedFinalCell=true;
        if(!await act(candidates[0],'选择有来源的日期'))return fail('选择日期后页面未保留目标值');
      }
      return fail('日历交互次数或等待时间达到上限');
    }
    return {fill};
  }
  // 动态契约按声明的网格推导必需字段；缺导航链即判无效，调用方拿到 null 后转入 AI 接管，不猜测。
  function validateContract(contract) {
    if (!contract || typeof contract !== 'object') return null;
    const grids = ['year','month','day'].filter(mode => contract[mode + 'Grid']);
    if (!grids.length) return null;
    for (const mode of grids) {
      if (!contract[mode + 'Cells']) return null;
      if (mode !== 'year' && !grids.includes('year')) return null;
      if (mode === 'month' && !contract.yearButton) return null;
      if (mode === 'day' && !contract.monthButton) return null;
    }
    if (grids.includes('year') && (!contract.prevDecade || !contract.nextDecade)) return null;
    return contract;
  }
  root.ResumeProCalendarAgent={create,monthNumber,validateContract};
  if(typeof module!=='undefined'&&module.exports)module.exports=root.ResumeProCalendarAgent;
})(typeof self!=='undefined'?self:globalThis);
