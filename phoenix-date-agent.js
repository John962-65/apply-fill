/* Phoenix RC Calendar DOM contract. Operate only the popup bound by the combo controller. */
(function(root){
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  function create({visible,panel,read,click,close,trace,until,readPeer}){
    const recognizes=p=>Boolean(p&&(p.matches('.phoenix-calendar')||p.querySelector('.phoenix-calendar')));
    const one=(p,selector)=>{const nodes=Array.from(p?.querySelectorAll(selector)||[]).filter(visible);return nodes.length===1?nodes[0]:null;};
    const enabled=n=>!n.matches('[disabled],[aria-disabled="true"],[class*="disabled"]')&&!n.querySelector('[aria-disabled="true"]');
    const number=(n,pattern)=>Number(n?.textContent.match(pattern)?.[0]);
    async function fill(entry,value){
      entry.datePadded=false;
      const peerBefore=readPeer?.(entry);
      const peerChanged=()=>peerBefore!==undefined&&readPeer(entry)!==peerBefore;
      const fail=reason=>{entry.fillNote=reason;trace(entry,'日历停止',reason);return false;};
      let p=panel(entry);
      if(!recognizes(p))return fail('未找到当前控件关联的凤凰日历');
      const monthMode=Boolean(one(p,'.phoenix-calendar-month-panel'));
      const target=root.ResumeProAIHelpers.normalizeDateForPrecision(value,monthMode?'month':'day');
      const parts=/^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(target.value);
      if(!parts||(!monthMode&&!parts[3]))return fail('目标日期缺少面板要求的年月日');
      const yy=Number(parts[1]),mm=Number(parts[2]),dd=Number(parts[3]);
      if(mm<1||mm>12||(!monthMode&&(dd<1||dd>new Date(Date.UTC(yy,mm,0)).getUTCDate())))return fail('目标日期无效');
      const same=()=>root.ResumeProAIHelpers.normalizeDateForPrecision(read(entry),monthMode?'month':'day').value===target.value;
      const header=p=>({year:number(one(p,monthMode?'.phoenix-calendar-month-panel-year-select':'.phoenix-calendar-year-select'),/\d{4}/),month:monthMode?mm:number(one(p,'.phoenix-calendar-month-select'),/\d{1,2}/)});
      trace(entry,'识别凤凰日历',monthMode?'月份面板':'日期面板');
      const started=Date.now();
      for(let step=0;step<60&&Date.now()-started<20000;step++){
        p=panel(entry);if(!recognizes(p))return fail('日历关闭或失去关联');
        const shown=header(p);
        if(!shown.year||!shown.month)return fail('无法唯一读取日历年月');
        if(shown.year===yy&&shown.month===mm){
          const names=['一','二','三','四','五','六','七','八','九','十','十一','十二'];
          const cells=Array.from(p.querySelectorAll(monthMode?'.phoenix-calendar-month-panel-cell':'.phoenix-calendar-cell')).filter(n=>visible(n)&&enabled(n));
          const candidates=cells.filter(n=>{
            const text=n.textContent.trim();
            // This fork deliberately omits td.title. Adjacent-month classes disambiguate day numbers.
            return monthMode?([`${mm}月`,`${names[mm-1]}月`,`${mm}`].includes(text))
              : !n.matches('.phoenix-calendar-last-month-cell,.phoenix-calendar-next-month-btn-day')&&text===String(dd);
          });
          if(candidates.length!==1)return fail(`日期格无法唯一确定（${candidates.length} 个候选）`);
          await click(candidates[0]);trace(entry,'选择日期格',monthMode?'选择目标月份':'选择目标日期');
          if(peerChanged())return fail('另一端日期被改变，请核对起止时间');
          if(!await until(same,1800))return fail('选择后页面未保留目标日期');
          await close(entry);await pause(250);
          if(peerChanged())return fail('另一端日期被改变，请核对起止时间');
          if(!same())return fail('关闭日历后目标日期被清空或改写');
          entry.verifiedChoice=read(entry);entry.fillNote='';entry.datePadded=target.padded;
          trace(entry,'核对','页面保留目标日期');return true;
        }
        const unit=shown.year!==yy?'year':'month';
        const direction=(unit==='year'?shown.year<yy:shown.month<mm)?'next':'prev';
        const prefix=monthMode?'phoenix-calendar-month-panel':'phoenix-calendar';
        const button=one(p,`.${prefix}-${direction}-${unit}-btn`);
        if(!button||!enabled(button))return fail('缺少唯一可用的日历翻页按钮');
        await click(button);trace(entry,'日历翻页',unit==='year'?'切换年份':'切换月份');
        if(!await until(()=>{const fresh=panel(entry);if(!recognizes(fresh))return false;const now=header(fresh);return now.year&&now.month&&(now.year!==shown.year||now.month!==shown.month);}))return fail('翻页后日历年月未改变');
      }
      return fail('日历操作达到时间或步数上限');
    }
    return {recognizes,fill};
  }
  root.ResumeProPhoenixDateAgent={create};
})(typeof self!=='undefined'?self:globalThis);
