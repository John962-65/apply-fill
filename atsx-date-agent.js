// Feishu ATS date controls observed in a user-provided DOM capture, not Ant calendar cells.
(() => {
  const LABEL='.atsx-date-picker-period-month-label';
  const LIST='.atsx-date-picker-period-month-panel-list';
  const ITEM='.atsx-date-picker-period-month-panel-list-item';
  const pause=ms=>new Promise(r=>setTimeout(r,ms));
  async function waitFor(fn){for(let i=0;i<25;i++){const v=fn();if(v)return v;await pause(80);}return null;}
  const enabled=n=>!n.closest('[disabled],[aria-disabled="true"],[class*="disabled"]');
  function create({click,visible,read}) {
    function trace(entry,action,detail){entry.interactions??=[];entry.interactions.push({action,detail});}
    const failure=(entry,reason,value)=>{entry.fillNote=reason;trace(entry,'日期停止',reason);return {ok:false,reason,value};};
    async function fillPeriod(entry,value) {
      const m=String(value).trim().match(/^(\d{4})[-/.年](\d{1,2})(?:$|[-/.月])/);
      if(!m||Number(m[2])<1||Number(m[2])>12)return failure(entry,'目标年月不明确',value);
      const wanted=m[1]+'-'+m[2].padStart(2,'0'),year=m[1],month=m[2].padStart(2,'0');
      const root=entry.pickerRoot,index=entry.periodIndex;
      const resolve=()=>{if(!root?.isConnected)return null;const labels=Array.from(root.querySelectorAll(LABEL));return labels.length===2?labels[index]:null;};
      const actual=()=>{const node=resolve();if(!node)return '';entry.element=node;return read(entry);};
      let node=resolve();if(!node)return failure(entry,'日期区间已替换或无法区分两端',wanted);
      if(actual())return failure(entry,'日期端点已有内容，未覆盖',wanted);
      const otherBefore=Array.from(root.querySelectorAll(LABEL))[1-index].textContent.trim();
      const panel=()=>{
        node=resolve();if(!node)return null;
        const r=node.getBoundingClientRect();
        // The captured component reuses one portal and moves it from start to end.
        // Require focus in this root AND alignment to this endpoint, never first-global-panel.
        if(!root.classList.contains('atsx-date-picker-focus')&&!root.contains(document.activeElement))return null;
        const candidates=Array.from(document.querySelectorAll('.atsx-date-picker-dropdown')).filter(p=>{
          if(!visible(p)||!p.querySelector('.atsx-date-picker-period-month-panel'))return false;
          const b=p.getBoundingClientRect();
          return Math.abs(b.left-r.left)<24 && (Math.abs(b.top-r.bottom)<40||Math.abs(b.bottom-r.top)<40);
        });
        return candidates.length===1?candidates[0]:null;
      };
      const choose=async(column,text)=>{
        let p=panel(),lists=p?Array.from(p.querySelectorAll(LIST)):[];
        if(lists.length!==2)throw Error('年月列表不是唯一的两列');
        let list=lists[column];
        const find=()=>Array.from(list.querySelectorAll(ITEM)).filter(n=>n.textContent.trim()===text&&enabled(n));
        let options=find();if(options.length!==1)throw Error('目标年月选项缺失、禁用或不唯一');
        options[0].scrollIntoView({block:'nearest',inline:'nearest'});await pause(120);
        p=panel();lists=p?Array.from(p.querySelectorAll(LIST)):[];list=lists[column];
        if(lists.length!==2)throw Error('滚动后年月面板失去关联');
        options=find();if(options.length!==1)throw Error('滚动后选项发生变化');
        // Scroll clipping is not captured by getBoundingClientRect alone.
        const b=options[0].getBoundingClientRect(),clip=list.getBoundingClientRect();
        if(b.top<clip.top-1||b.bottom>clip.bottom+1)throw Error('目标选项仍在滚动区域外');
        await click(options[0]);trace(entry,column?'选择月份':'选择年份',text);
        await pause(180);
      };
      try {
        await click(node);trace(entry,'打开日期区间',index?'结束时间':'开始时间');
        if(!await waitFor(panel))return failure(entry,'未出现关联的年月列表',wanted);
        await choose(0,year);
        if(!await waitFor(()=>panel()?.querySelectorAll(LIST).length===2))return failure(entry,'选择年份后月份列表未就绪',wanted);
        await choose(1,month);
        if(!await waitFor(()=>actual()===wanted))return failure(entry,'选择年月后当前端点未保留目标值',wanted);
        // Blur the internal focus holder, then verify again after framework updates.
        root.querySelector('input')?.blur();await pause(220);
        if(actual()!==wanted)return failure(entry,'日期失焦后目标值被页面清空',wanted);
        if(root.querySelectorAll(LABEL)[1-index].textContent.trim()!==otherBefore)return failure(entry,'操作影响了另一端日期，请核对',wanted);
        trace(entry,'日期核对','当前端点年月正确，另一端未改动');return {ok:true,value:wanted,padded:false};
      }catch(error){return failure(entry,error.message,wanted);}
    }
    async function fillYear(entry,element,current,value) {
      const year=String(value).match(/^(\d{4})(?:$|[-/.年])/)?.[1];
      if(!year)return failure(entry,'目标年份不明确',value);
      const actual=()=>entry?read(entry):String(element.value||'');
      try{
        for(let step=0;step<30;step++){
          const p=current();if(!p)return failure(entry,'年份面板失去关联',year);
          const cells=Array.from(p.querySelectorAll('.atsx-date-picker-panel-body-year .atsx-date-picker-panel-body-cell')).filter(n=>visible(n)&&enabled(n));
          const matches=cells.filter(n=>n.textContent.trim()===year);
          if(matches.length>1)return failure(entry,'目标年份不唯一',year);
          if(matches.length===1){await click(matches[0]);trace(entry,'选择获奖年份',year);await waitFor(()=>actual()===year);element.blur();await pause(220);return actual()===year?{ok:true,value:year,padded:false}:failure(entry,'年份选择后未保留目标值',year);}
          const values=cells.map(n=>Number(n.textContent.trim())).filter(n=>n>=1000&&n<=9999);
          if(!values.length)return failure(entry,'未找到可选年份',year);
          const min=Math.min(...values),max=Math.max(...values),back=Number(year)<min;
          if(Number(year)>=min&&Number(year)<=max)return failure(entry,'目标年份被禁用或缺失',year);
          const buttons=Array.from(p.querySelectorAll('.atsx-date-picker-panel-header-operator')).filter(n=>visible(n)&&enabled(n));
          if(buttons.length!==2)return failure(entry,'年份翻页按钮不明确',year);
          const title=p.querySelector('.atsx-date-picker-panel-header-title')?.textContent;
          await click(buttons[back?0:1]);trace(entry,'年份翻页',back?'向前':'向后');
          const moved=await waitFor(()=>{const q=current();return q&&q.querySelector('.atsx-date-picker-panel-header-title')?.textContent!==title;});
          if(!moved)return failure(entry,'点击后年份范围未更新',year);
          const next=Array.from(current().querySelectorAll('.atsx-date-picker-panel-body-cell')).map(n=>Number(n.textContent.trim())).filter(n=>n>=1000&&n<=9999);
          if(!next.length||(back?Math.min(...next)>=min:Math.max(...next)<=max))return failure(entry,'年份翻页方向异常',year);
        }
        return failure(entry,'年份翻页次数达到上限',year);
      }catch(error){return failure(entry,error.message,year);}
    }
    return {fillPeriod,fillYear};
  }
  self.ResumeProAtsxDateAgent={create};
})();
