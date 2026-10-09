/* UD date shells observed on nio.jobs.feishu.cn. Popup navigation is semantic:
   unique owned panel, explicit date cells/accessible buttons, then commit proof.
   Unknown or ambiguous layouts stop and can be exported by control-capture. */
(function(root){
  'use strict';
  const SHELL='.ud__picker,.throne-biz-date-range-picker,.throne-biz-date-range-picker-input';
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const text=n=>String(n.getAttribute('aria-label')||n.getAttribute('title')||n.textContent||'').replace(/\s+/g,' ').trim();
  const date=s=>String(s||'').replace(/\s+/g,'').replace(/[年月]/g,'-').replace(/日$/,'').replace(/-$/,'')
    .match(/^(\d{4})(?:[-/.](\d{1,2}))?(?:[-/.](\d{1,2}))?$/)?.slice(1).filter(Boolean).map(Number)||[];
  function create({visible,click,escape,readPeer,refresh}){
    const pending=new WeakMap();
    const recognizes=entry=>Boolean(entry?.element?.closest?.(SHELL));
    const read=entry=>{
      const value=String(entry.element?.value||'').trim();
      if(pending.has(entry.element)&&pending.get(entry.element)!==value)pending.delete(entry.element);
      return pending.has(entry.element)?'':value;
    };
    const outer=nodes=>[...new Set(nodes)].filter(n=>!nodes.some(p=>p!==n&&p.contains(n)));
    const usable=n=>visible(n)&&!n.closest('[aria-disabled="true"],[disabled],[aria-hidden="true"]')&&!/disabled/.test(String(n.className||''));
    const cells=p=>Array.from(p.querySelectorAll('[role="gridcell"],[role="option"],td,[data-date],[class*="cell" i],[class*="month-item" i],[class*="year-item" i]'))
      .filter(usable).filter(n=>!n.querySelector('input,textarea,select,a'));
    const floating=()=>outer(Array.from(document.querySelectorAll('[role="dialog"],[role="listbox"],[class*="picker" i],[class*="calendar" i],[class*="popover" i]'))
      .filter(n=>visible(n)&&!n.closest('#resume-pro-sidebar')&&!n.matches('body,html,form,main')
        &&!n.querySelector('textarea,select')&&['absolute','fixed'].includes(getComputedStyle(n).position)&&cells(n).length));
    const values=p=>cells(p).map(n=>({n,label:text(n)}));
    const unique=nodes=>{const leaves=nodes.filter(n=>!nodes.some(other=>other!==n&&n.contains(other)));return leaves.length===1?leaves[0]:null;};
    function button(panel,pattern){return unique(Array.from(panel.querySelectorAll('button,[role="button"]')).filter(usable)
      .filter(n=>!(n.tagName==='BUTTON'&&n.type==='submit'&&n.closest('form'))&&pattern.test(text(n))));}
    function udNavigation(panel,previous){
      // The captured month header has a collapse button plus exactly two
      // arrow buttons. Keep navigation local to that header and verify its
      // year advances in the intended direction after the click.
      const headers=Array.from(panel.querySelectorAll('.ud__picker-panel-header')).filter(usable);
      if(headers.length!==1)return null;
      const buttons=Array.from(headers[0].querySelectorAll('button.ud__picker-panel-header-icon:not(.ud__picker-panel-header-collapse)')).filter(usable);
      if(buttons.length!==2||buttons[0].getBoundingClientRect().left>=buttons[1].getBoundingClientRect().left)return null;
      return buttons[previous?0:1];
    }
    async function fill(entry,value,precision){
      let element=entry.element;const helpers=root.ResumeProAIHelpers;
      if(precision==='auto')precision=element.closest('.throne-biz-date-range-picker-input')?'month':date(value).length===3?'day':'month';
      const target=helpers.normalizeDateForPrecision(value,precision),wanted=date(target.value);
      const trace=(action,detail)=>{entry.interactions??=[];entry.interactions.push({action,detail});};
      let owned=null,selected=false,confirmed=false,blocked=false,failed=false;
      const baseline=new Set(floating()),peerBefore=entry.rangePeer?readPeer?.(entry.rangePeer):undefined;
      const fail=reason=>{failed=true;entry.fillNote=reason;trace('日历停止',reason);return {ok:false,value:target.value,padded:target.padded,reason};};
      const panel=()=>{
        const owners=[];for(let n=element,i=0;n&&i<5;n=n.parentElement,i++)owners.push(n);
        const ids=new Set(owners.flatMap(n=>['aria-controls','aria-owns'].flatMap(k=>(n.getAttribute(k)||'').split(/\s+/).filter(Boolean))));
        const linked=outer([...ids].map(id=>document.getElementById(id)).filter(n=>n&&visible(n)&&!n.contains(element)&&!n.matches('body,html,form,main')));
        if(linked.length>1){blocked=true;return null;}
        if(linked.length===1)return owned=linked[0];
        if(owned?.isConnected&&visible(owned))return owned;
        const appeared=floating().filter(n=>!baseline.has(n)&&!n.contains(element));
        if(appeared.length>1){blocked=true;return null;}
        return appeared.length===1?owned=appeared[0]:null;
      };
      const same=()=>{const actual=date(element.value);return actual.length>=wanted.length&&wanted.every((n,i)=>actual[i]===n);};
      const committed=()=>selected&&!blocked&&!panel()&&same();
      try{
        if(!wanted.length)return fail('目标日期不明确');
        if(!element.isConnected)return fail('日期输入框已被替换');
        pending.set(element,String(element.value||'').trim());
        await click(element);trace('打开飞书日历','读取当前日期框关联面板');
        for(let i=0;i<18&&!panel()&&!blocked;i++)await wait(80);
        let unchanged=0,previous='';const started=Date.now();
        for(let step=0;step<48&&Date.now()-started<15000;step++){
          if(!element.isConnected){
            const fresh=refresh?.(entry);
            if(!fresh?.element?.isConnected||!recognizes(fresh))return fail('日期输入框已被替换，不能唯一定位');
            element=entry.element=fresh.element;
          }
          if(entry.rangePeer&&readPeer?.(entry.rangePeer)!==peerBefore)return fail('另一端日期发生变化，停止本条经历');
          if(committed()){
            element.blur();await wait(200);
            if(!committed())return fail('日期确认后被页面撤回');
            pending.delete(element);entry.fillNote='';trace('核对','日期已选择确认，页面保留目标值');
            return {ok:true,value:target.value,padded:target.padded};
          }
          const p=panel();
          if(!p)return fail(blocked?'日期面板归属不唯一':'未出现可识别的关联日历；请自动采集弹层');
          if(selected){
            if(confirmed){for(let i=0;i<10&&!committed();i++)await wait(80);if(committed())continue;return fail('点击确认后，日历没有提交目标日期');}
            const confirm=button(p,/^(确认|确定|完成|ok|confirm|apply)$/i);
            if(!confirm)return fail('日期格已点击，但未找到唯一确认按钮且面板未关闭');
            await click(confirm);confirmed=true;trace('确认日期','点击当前日历内的确认按钮');await wait(160);continue;
          }
          const pool=values(p),fingerprint=p.textContent.replace(/\s+/g,'').slice(0,10000);
          unchanged=fingerprint===previous?unchanged+1:0;previous=fingerprint;
          if(unchanged>2)return fail('日历操作没有推进，停止重复点击');
          const exact=cells(p).filter(n=>['data-date','title','aria-label'].some(k=>{
            const actual=date(n.getAttribute(k));return actual.length===wanted.length&&wanted.every((v,i)=>v===actual[i]);
          }));
          let choice=unique(exact);
          if(exact.length&&!choice)return fail('目标日期格不唯一');
          const compact=s=>String(s).replace(/\s/g,'');
          const years=pool.filter(c=>/^\d{4}年?$/.test(compact(c.label)));
          const months=pool.filter(c=>/^(?:0?[1-9]|1[0-2])月$/.test(compact(c.label)));
          if(!choice&&years.length>=3){
            choice=unique(years.filter(c=>Number(compact(c.label).replace('年',''))===wanted[0]).map(c=>c.n));
            if(!choice){
              const ys=years.map(c=>Number(compact(c.label).replace('年',''))),prev=wanted[0]<Math.min(...ys);
              const nav=button(p,prev?/^(上一页|前十年|上一年代|previous decade|prev decade)$/i:/^(下一页|后十年|下一年代|next decade)$/i)||udNavigation(p,prev);
              if(!nav)return fail('缺少可确认的年份翻页按钮');await click(nav);trace('日历翻页','切换年份列表');await wait(120);
              const after=values(panel()||p).filter(c=>/^\d{4}年?$/.test(compact(c.label))).map(c=>Number(compact(c.label).replace('年','')));
              if(!after.length||(prev?Math.min(...after)>=Math.min(...ys):Math.max(...after)<=Math.max(...ys)))return fail('年份列表未按目标方向切换');
              continue;
            }
            selected=precision==='year';await click(choice);trace('选择年份','使用目标年份格');await wait(120);continue;
          }
          const headerNodes=Array.from(p.querySelectorAll('[class*="header" i],[role="heading"],button,[role="button"]')).filter(usable);
          const headers=headerNodes.map(n=>compact(text(n))),headerYears=[...new Set(headers.flatMap(s=>s.match(/^(\d{4})年?(?:[-/.年]?\d{1,2}月?)?$/)?.[1]?[Number(s.match(/^(\d{4})/)[1])]:[]))];
          const year=headerYears.length===1?headerYears[0]:null;
          const headerMonths=[...new Set(headers.flatMap(s=>s.match(/^\d{4}年\s*(\d{1,2})月$/)?.[1]?[Number(s.match(/^\d{4}年\s*(\d{1,2})月$/)[1])]:[]))];
          const month=headerMonths.length===1?headerMonths[0]:null;
          if(!choice&&year!==wanted[0]){
            if(year===null)return fail('不能确认当前日历年份');
            const prev=wanted[0]<year,nav=button(p,prev?/^(上一年|前一年|previous year|prev year)$/i:/^(下一年|后一年|next year)$/i);
            const yearToggle=button(p,new RegExp('^'+year+'年?$'))
              ||unique(Array.from(p.querySelectorAll('.ud__picker-panel-header-btn')).filter(usable).filter(n=>compact(text(n))===year+'年'));
            const udNav=!nav&&!yearToggle?udNavigation(p,prev):null;
            if(!nav&&!yearToggle&&!udNav)return fail('缺少可确认的年份切换按钮');
            await click(nav||yearToggle||udNav);trace('日历翻页',nav||udNav?'切换年份':'打开年份列表');await wait(120);
            if(udNav){
              const after=Array.from((panel()||p).querySelectorAll('.ud__picker-panel-header-btn')).filter(usable).map(n=>Number(compact(text(n)).match(/^(\d{4})年$/)?.[1])).filter(Number.isFinite);
              if(after.length!==1||(prev?after[0]>=year:after[0]<=year))return fail('日历年份未按目标方向切换');
            }
            continue;
          }
          if(!choice&&months.length>=4&&year===wanted[0]){
            choice=unique(months.filter(c=>Number(compact(c.label).replace('月',''))===wanted[1]).map(c=>c.n));
            if(!choice)return fail('目标月份格不唯一');
            selected=precision==='month';await click(choice);trace('选择月份','使用目标月份格');await wait(120);continue;
          }
          if(!choice&&precision==='day'&&year===wanted[0]&&month===wanted[1]){
            const days=pool.filter(c=>/^(?:[1-9]|[12]\d|3[01])日?$/.test(c.label));
            if(days.length>=28)choice=unique(days.filter(c=>Number(c.label.replace('日',''))===wanted[2]).map(c=>c.n));
          }
          if(!choice&&year===wanted[0]){
            const nav=precision==='day'&&month&&month!==wanted[1]?button(p,month>wanted[1]?/^(上一月|上个月|previous month|prev month)$/i:/^(下一月|下个月|next month)$/i):null;
            if(nav){await click(nav);trace('日历翻页','切换月份');await wait(120);continue;}
            const monthToggle=button(p,/^(?:[1-9]|1[0-2])月$/);
            if(monthToggle){await click(monthToggle);trace('打开月份列表','读取目标月份候选');await wait(120);continue;}
          }
          if(!choice)return fail('未识别当前日历的日期格；请自动采集弹层');
          await click(choice);selected=true;trace('选择日期格','点击明确对应目标日期的格子');await wait(160);
        }
        return fail('日历操作达到上限，日期未确认');
      }catch(error){return fail(error.message||'日历操作失败');}
      finally{
        if(failed){pending.set(element,String(element.value||'').trim());if(element.isConnected)try{await escape(element);}catch{}element.blur();}
      }
    }
    return {recognizes,fill,read,uncommitted:entry=>pending.has(entry.element)};
  }
  root.ResumeProUdDateAgent={create};
})(typeof self!=='undefined'?self:globalThis);
