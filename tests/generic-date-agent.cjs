// 通用日期交互 Agent：未知类名族 + 无 ARIA + 每次渲染全量重建节点。
// 两条驱动路径都要验证：合成契约快路径（0 次模型调用）与脚本化 AI 逐步循环。
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const FIXTURE=fs.readFileSync(path.join(__dirname,'fixtures/unknown-date-picker.html'),'utf8');

// 脚本化"正确模型"：按观察导航到包含目标的视图，只选语义等于目标的格子。
const POLICY=`(observation)=>{
  const c=observation.candidates||[],panel=observation.panel||{};
  const parts=String(observation.target||'').split('-').map(Number);
  const y=parts[0],m=parts[1]||null,d=parts[2]||null;
  const modes=panel.modes||[],header=panel.header||{};
  const one=kind=>c.find(x=>x.kind===kind);
  if(!observation.panel){
    const t=one('type');if(t)return {id:t.id};
    const icon=one('open-icon');if(icon)return {id:icon.id};
    const open=one('open');if(open)return {id:open.id};
    return {id:(c.find(x=>x.kind==='stop')||{id:'stop'}).id};
  }
  if(modes.includes('year')){const a=one('choose-year');if(a)return {id:a.id};}
  if(modes.includes('month')){
    if(header.year!==y){const a=one('open-year-view');if(a)return {id:a.id};}
    const a=one('choose-month');if(a)return {id:a.id};
  }
  if(panel.selected){const a=one('confirm');if(a)return {id:a.id};}
  if(modes.includes('day')){
    // pick-day 只在目标日期格唯一可见时出现：它存在即说明目标月已显示，直接选。
    const a=one('choose-day');if(a)return {id:a.id};
    if(header.year!==y){const a=one('open-year-view');if(a)return {id:a.id};}
    if(header.month!==m){const a=one('open-month-view');if(a)return {id:a.id};}
  }
  return {id:(c.find(x=>x.kind==='stop')||c[0]||{}).id};
}`;

async function scenario(browser,{mode,script=[],policy=false,target='2024-09-15',contract=true,pipeline=false,checkbox=false,peer=false,handoff=false,useCdp=false,forceFirstOpen=false,traceCheck=false,extraInit=''}){
  const {performInput}=await import('../browser-input.mjs');
  const page=await browser.newPage({viewport:{width:1100,height:900}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const cdp=await page.context().newCDPSession(page);
  await page.exposeFunction('realInput',a=>performInput((m,p)=>cdp.send(m,p),a));
  await page.route('https://fixture.invalid/**',r=>r.fulfill({contentType:'text/html',body:FIXTURE}));
  await page.goto('https://fixture.invalid/form?mode='+mode);
  await page.evaluate(({script,checkbox,contract,POLICY,pipeline})=>{
    self.__RESUME_PRO_TEST__=true;
    if(!pipeline){
      self.__APPLY_FILL_DATE_MODE__='agent-only';
      self.__APPLY_FILL_DATE_DISABLE_CONTRACT__=!contract;
    }
    self.scriptedDecisions=script;
    self.POLICY_SRC=POLICY;
    self.modelCalls=0;
    self.facts={'入学时间':'2024-09-15'};
    self.fixtureStore={templates:[{id:'t',name:'匿名资料',groups:[{id:'g',name:'教育背景',fields:Object.entries(facts).map(([label,value],i)=>({id:'s'+i,key:label,label,value}))}]}],activeTemplateId:'t',aiConfig:{apiUrl:'https://fixture.invalid/api',model:'fixture',apiKey:'fixture'}};
    self.checkboxOn=checkbox;
    self.chrome={runtime:{id:'fixture',getManifest:()=>({version:'test'}),getURL:p=>new URL(p,location.origin).href,sendMessage:async m=>{
      if(m.type==='BROWSER_INPUT')return realInput(m.action);
      if(m.type==='AI_FILL')return {success:true,matches:m.formFields.flatMap(f=>facts[f.label]?[{fieldId:f.fieldId,value:facts[f.label],resumeKey:f.label,source:'ai'}]:[])};
      if(m.type==='AI_INTERACTION_STEP'){modelCalls++;const c=m.observation.candidates||[];const next=scriptedDecisions.shift();
        if(next)return {success:true,action:{id:next}};
        return {success:true,action:{id:(c.find(x=>x.kind==='stop')||c[0]).id}};}
      return {ready:true};
    }},storage:{local:{get:async()=>structuredClone(fixtureStore),set:async c=>Object.assign(fixtureStore,c)},onChanged:{addListener(){}}}};
  },{script,checkbox,contract,POLICY,pipeline});
  if(extraInit)await page.evaluate(extraInit);
  // 侧边栏宿主必须在内容脚本加载前就存在：content.js 启动时会自建侧边栏并占用内部 shadowRoot 引用。
  await page.evaluate(()=>{
    const host=document.createElement('div');host.id='resume-pro-sidebar';document.body.append(host);
    const h=host.attachShadow({mode:'open'});
    h.innerHTML='<button id="resume-pro-ai-fill">填写</button><div id="resume-pro-status"></div>'
      +'<input type="checkbox" id="resume-pro-generic-date">'
      +'<input type="checkbox" id="resume-pro-browser-input">'
      +'<details id="resume-pro-trace"><textarea id="resume-pro-trace-text"></textarea></details>'
      +'<details id="resume-pro-diagnostics"><textarea id="resume-pro-diagnostics-text"></textarea></details>'
      +'<p id="resume-pro-wait-hint" role="status"></p>';
  });
  for(const script of JSON.parse(fs.readFileSync(path.join(root,'manifest.json'))).content_scripts[0].js)await page.addScriptTag({path:path.join(root,script)});
  const result=await page.evaluate(async ({target,pipeline,checkbox,policy,peer,handoff,forceFirstOpen,useCdp,traceCheck})=>{
    const api=ResumeProHighlightTest;
    const makeEntry=()=>{
      const scan=api.scanFillableFields();
      const field=scan.fields.find(f=>scan.fieldMap.get(f.fieldId).element?.id==='edu-start');
      const entry=scan.fieldMap.get(field.fieldId);entry.meta=field;
      if(peer)entry.rangePeer={element:document.getElementById('edu-end')};
      if(policy)entry.decide=async observation=>{
        self.modelCalls++;
        const decide=(new Function('return '+self.POLICY_SRC))();
        // forceFirstOpen：先强制选一次 open（预期 NO_CHANGE），验证换策略不会被无进展计数误杀。
        if(forceFirstOpen && !self.firstOpenDone){
          const open=observation.candidates.find(c=>c.kind==='open');
          if(open){self.firstOpenDone=true;return {id:open.id};}
        }
        return decide(observation);
      };
      return entry;
    };
    if(!pipeline){
      // 直接场景也挂上我们的 shadow：CDP 开关（实验：浏览器层点击与输入）从这里读取。
      const hostShadow=document.getElementById('resume-pro-sidebar').shadowRoot;
      api.setShadowRoot(hostShadow);
      hostShadow.querySelector('#resume-pro-browser-input').checked=useCdp;
      if(traceCheck){
        // 失败记录缺 observation（实站出现过的形态）不得让报告阶段抛异常。
        const fields=[{fieldId:'f1',label:'开始时间',inputType:'text'},{fieldId:'f2',label:'学历',inputType:'combobox'}];
        const fieldMap=new Map([['f1',{interactionResult:{status:'RECOVERED',code:'VALUE_UNCONFIRMED'}}],['f2',{}]]);
        const outcomes=new Map([['f1',{ok:false}],['f2',{ok:false}]]);
        try{
          const text=api.formatFieldTrace({fields,fieldMap,matches:[{fieldId:'f1',source:'ai',value:'2024-09-15'},{fieldId:'f2',source:'ai',value:'硕士'}],outcomes,unlabeledCombos:0,notices:new Map(),dropped:[],droppedTotal:0});
          return {traceOk:true,traceRow:text.split('\n').find(l=>l.includes('交互结果'))||''};
        }catch(error){return {traceOk:false,traceError:{message:error.message}};}
      }
      const entry=makeEntry();
      if(handoff){
        const rejected=api.genericDateAgent.inspectHandoff(entry,{peerBefore:'1999-01-01'});
        const accepted=api.genericDateAgent.inspectHandoff(entry,{peerBefore:document.getElementById('edu-end').value||''});
        return {rejected,accepted};
      }
      const started=Date.now();
      const result=await api.fillDateWithAgent(entry,target,entry.meta);
      return {result,value:document.getElementById('edu-start').value,end:document.getElementById('edu-end').value,
        note:entry.fillNote,status:entry.interactionResult,trace:entry.interactions,open:document.querySelectorAll('.acme-picker-portal.open').length,
        modelCalls:self.modelCalls,ms:Date.now()-started};
    }
    const host=document.getElementById('resume-pro-sidebar'),h=host.shadowRoot;
    h.querySelector('#resume-pro-generic-date').checked=checkbox;
    h.querySelector('#resume-pro-browser-input').checked=useCdp;
    fixtureStore.templates=fixtureStore.templates.map(ResumeProTree.normalizeTemplate);
    api.setShadowRoot(h);api.setCurrentStore(fixtureStore);
    let fillError='';
    try{await api.handleAiFillClick({currentTarget:h.querySelector('button')});}
    catch(error){fillError=error&&error.stack||String(error);}
    return {fillError,status:h.querySelector('#resume-pro-status').textContent,diagnostics:h.querySelector('#resume-pro-diagnostics-text').value,
      value:document.getElementById('edu-start').value,modelCalls:self.modelCalls,
      trace:h.querySelector('#resume-pro-trace-text').value};
  },{target,pipeline,checkbox,policy,peer,handoff,forceFirstOpen,useCdp,traceCheck});
  result.errors=errors;
  await page.close();
  return result;
}

(async()=>{
  const {performInput}=await import('../browser-input.mjs');
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH,args:['--no-sandbox']});
  try{
    // 1. 合成契约快路径：未知类名日历，0 次模型调用。
    let r=await scenario(browser,{mode:'day'});
    assert.equal(r.result.ok,true,JSON.stringify({r:r.result,note:r.note,trace:r.trace}));
    assert.equal(r.value,'2024-09-15');assert.equal(r.result.via,'contract');
    assert.equal(r.modelCalls,0,'contract fast path must not call the model');
    assert.equal(r.open,0);assert.deepEqual(r.errors,[]);
    console.log('PASS generic date / contract day view:',r.ms+'ms');

    // 2. AI 逐步循环（关闭快路径）：脚本化正确决策能完成同一控件。
    r=await scenario(browser,{mode:'day',contract:false,policy:true});
    assert.equal(r.result.ok,true,JSON.stringify({r:r.result,note:r.note,trace:r.trace}));
    assert.equal(r.value,'2024-09-15');assert.equal(r.result.via,'ai-loop');
    assert.ok(r.modelCalls>=3&&r.modelCalls<=14,'model calls within budget: '+r.modelCalls);
    assert.equal(r.open,0);assert.deepEqual(r.errors,[]);
    console.log('PASS generic date / AI loop day view: '+r.modelCalls+' model calls');

    // 3. 精度关键用例：资料存 2024-09-01，网页只要 2024-09。
    r=await scenario(browser,{mode:'month',target:'2024-09-01'});
    assert.equal(r.result.ok,true,JSON.stringify({r:r.result,note:r.note}));
    assert.equal(r.value,'2024-09','page precision month must win over resume day value');
    assert.equal(r.modelCalls,0);console.log('PASS generic date / month-only precision');

    // 4. 纯 AI 模式的月精度。
    r=await scenario(browser,{mode:'month',target:'2024-09-01',contract:false,policy:true});
    assert.equal(r.result.ok,true,JSON.stringify({r:r.result,note:r.note,trace:r.trace}));
    assert.equal(r.value,'2024-09');assert.ok(r.modelCalls>=2&&r.modelCalls<=14,'calls '+r.modelCalls);
    console.log('PASS generic date / AI loop month precision: '+r.modelCalls+' calls');

    // 5. 十年翻页：初始 2035，目标 2024 必须先翻年代。
    r=await scenario(browser,{mode:'far'});
    assert.equal(r.result.ok,true,JSON.stringify({r:r.result,note:r.note}));
    assert.equal(r.value,'2024-09-15');console.log('PASS generic date / decade paging via contract');

    // 6. 需要确认按钮的日历（规则路径）。
    r=await scenario(browser,{mode:'confirm'});
    assert.equal(r.result.ok,true,JSON.stringify({r:r.result,note:r.note}));
    assert.equal(r.value,'2024-09-15');console.log('PASS generic date / confirm button via contract');

    // 7. 需要确认按钮的日历（AI 路径：选格子 → 确认）。
    r=await scenario(browser,{mode:'confirm',contract:false,policy:true});
    assert.equal(r.result.ok,true,JSON.stringify({r:r.result,note:r.note,trace:r.trace}));
    assert.equal(r.value,'2024-09-15');console.log('PASS generic date / confirm button via AI loop');

    // 8. 异步打开的弹层。
    r=await scenario(browser,{mode:'async'});
    assert.equal(r.result.ok,true,JSON.stringify({r:r.result,note:r.note}));
    console.log('PASS generic date / async open');

    // 9. 面板收不起：值写进去了也不能算成功，必须 BLOCKED 并保留现场。
    r=await scenario(browser,{mode:'stuckclose'});
    assert.equal(r.result,false,JSON.stringify({r:r.result,note:r.note}));
    assert.equal(r.open,1,'panel must stay open for inspection');
    assert.equal(r.status&&r.status.status,'BLOCKED');assert.equal(r.status&&r.status.code,'POPUP_CLOSE_UNCONFIRMED');
    console.log('PASS generic date / stuck panel is BLOCKED, never fake success');

    // 10. 时分面板：规则路径拒绝，不误报成功。
    r=await scenario(browser,{mode:'time',policy:true});
    assert.equal(r.result,false,JSON.stringify({r:r.result,note:r.note}));
    assert.equal(r.status&&r.status.status,'RECOVERED');assert.match(r.note,/时分|未确认|精度|停止/);
    console.log('PASS generic date / time panel refuses to fake success:',r.note);

    // 11. 面板无日期结构：没有等价动作必须停止，不猜测。
    r=await scenario(browser,{mode:'junk',policy:true});
    assert.equal(r.result,false,JSON.stringify({r:r.result,note:r.note}));
    assert.equal(r.value,'');assert.deepEqual(r.errors,[]);
    console.log('PASS generic date / structureless panel stops instead of guessing');

    // 12. peer 保护：填开始时间不动结束时间。
    r=await scenario(browser,{mode:'day',peer:true,extraInit:`fixtureSet('edu-end','2026-06-30');`});
    assert.equal(r.result.ok,true,JSON.stringify({r:r.result,note:r.note}));
    assert.equal(r.end,'2026-06-30');console.log('PASS generic date / peer end date untouched');

    // 13. 接管前检查：peer 基线不一致 → 拒绝接管。
    r=await scenario(browser,{mode:'day',peer:true,handoff:true,extraInit:`fixtureSet('edu-end','2026-06-30');`});
    assert.equal(r.rejected.safe,false);assert.equal(r.rejected.code,'PEER_CHANGED');
    assert.equal(r.accepted.safe,true,JSON.stringify(r.accepted));
    console.log('PASS generic date / handoff guard rejects changed peer');

    // 14. 完整管线：规则被组件还原 → 接管开关开启 → 契约快路径完成，0 次模型调用。
    r=await scenario(browser,{mode:'single',pipeline:true,checkbox:true});
    assert.equal(r.modelCalls,0,'pipeline contract fast path must not call the model: '+JSON.stringify(r));
    assert.equal(r.value,'2024-09-15');assert.match(r.status,/已填写 1 个字段/);assert.deepEqual(r.errors,[]);
    console.log('PASS generic date / full pipeline takeover with flag on');

    // 15. 完整管线：开关关闭时保持原有失败行为。
    r=await scenario(browser,{mode:'single',pipeline:true,checkbox:false});
    assert.equal(r.value,'','flag off must leave the field empty: '+JSON.stringify(r));
    assert.match(r.status,/1 项没填上/);console.log('PASS generic date / full pipeline flag off keeps old behavior');

    // 16. 核心接管场景：点击输入框无效，AI 通过日历图标打开 —— v0.8.21 真实日志的主故障。
    r=await scenario(browser,{mode:'icononly',policy:true});
    assert.equal(r.result.ok,true,JSON.stringify({r:r.result,note:r.note,trace:r.trace}));
    assert.equal(r.value,'2024-09-15');assert.equal(r.result.via,'ai-loop');
    assert.match(JSON.stringify(r.trace),/尝试打开日历/,'AI must use the icon to open: '+JSON.stringify(r.trace));
    assert.equal(JSON.stringify(r.trace).match(/点击日期控件/g).length,1,'trigger clicked exactly once before falling to the icon');
    assert.deepEqual(r.errors,[]);console.log('PASS generic date / AI opens via calendar icon: '+r.modelCalls+' calls');
    // 没有 AI 决策器时保持原有失败语义。
    r=await scenario(browser,{mode:'icononly'});
    assert.equal(r.result,false,JSON.stringify({r:r.result,note:r.note}));
    assert.match(r.note,/未出现可识别的关联日历/);console.log('PASS generic date / icon-only without AI keeps old failure');

    // 17. 脏状态接管：面板已由上一次操作打开（extraInit 阶段点击），接管时从已有状态继续，不重新点击输入框。
    r=await scenario(browser,{mode:'day',policy:true,extraInit:`document.getElementById('edu-start').click();`});
    assert.equal(r.result.ok,true,JSON.stringify({r:r.result,note:r.note,trace:r.trace}));
    assert.equal(r.value,'2024-09-15');
    assert.match(JSON.stringify(r.trace),/识别日历/,'panel must be adopted from the dirty state');
    assert.doesNotMatch(JSON.stringify(r.trace),/点击日期控件/,'dirty handoff must not re-click the trigger');
    console.log('PASS generic date / dirty handoff continues from open panel');

    // 18. type 动作：输入框可编辑且无日历时，AI 选择直接输入（此前该分支不可达）。
    r=await scenario(browser,{mode:'typeable',policy:true});
    assert.equal(r.result.ok,true,JSON.stringify({r:r.result,note:r.note,trace:r.trace}));
    assert.equal(r.value,'2024-09-15');
    assert.match(JSON.stringify(r.trace),/直接输入目标日期/,JSON.stringify(r.trace));
    assert.equal(r.modelCalls,1,'type should resolve in one decision: '+r.modelCalls);
    console.log('PASS generic date / type action commits typed date');

    // 19. 无进展计数回归：先强制选一次 open（预期 NO_CHANGE），AI 换策略点图标必须不被误杀。
    // 旧实现按观察次数计数（每步两次观察），一次失败动作就会烧掉 2/3 的预算。
    r=await scenario(browser,{mode:'icononly',policy:true,forceFirstOpen:true});
    assert.equal(r.result.ok,true,JSON.stringify({r:r.result,note:r.note,trace:r.trace}));
    assert.equal(r.value,'2024-09-15');
    const traceText=JSON.stringify(r.trace);
    assert.match(traceText,/点击当前日期控件尝试打开日历/,'first open attempt must be recorded');
    assert.match(traceText,/尝试打开日历/,'icon fallback must follow');
    assert.ok(r.modelCalls>=6,'full navigation after the failed open: '+r.modelCalls);
    console.log('PASS generic date / strategy switch survives no-progress counter: '+r.modelCalls+' calls');

    // 20-24. CDP 集成轮：同一批场景开「实验：浏览器层点击与输入」，真实 CDP 键鼠路径。
    r=await scenario(browser,{mode:'day',useCdp:true});
    assert.equal(r.result.ok,true,JSON.stringify({r:r.result,note:r.note}));
    assert.equal(r.value,'2024-09-15');assert.equal(r.result.via,'contract');
    console.log('PASS generic date cdp / contract day view via real input');

    r=await scenario(browser,{mode:'icononly',policy:true,useCdp:true});
    assert.equal(r.result.ok,true,JSON.stringify({r:r.result,note:r.note,trace:r.trace}));
    assert.equal(r.value,'2024-09-15');
    console.log('PASS generic date cdp / calendar icon open via real input: '+r.modelCalls+' calls');

    r=await scenario(browser,{mode:'confirm',useCdp:true});
    assert.equal(r.result.ok,true,JSON.stringify({r:r.result,note:r.note}));
    assert.equal(r.value,'2024-09-15');
    console.log('PASS generic date cdp / confirm button via real input');

    r=await scenario(browser,{mode:'stuckclose',useCdp:true});
    assert.equal(r.result,false,JSON.stringify({r:r.result,note:r.note}));
    assert.equal(r.status&&r.status.status,'BLOCKED');
    console.log('PASS generic date cdp / stuck panel still BLOCKED with real Escape');

    // 遮挡：覆盖层盖住面板，CDP 命中测试必须拒绝点击；合成路径作为对照证明控件本身可填。
    r=await scenario(browser,{mode:'covered',useCdp:true});
    assert.equal(r.result,false,JSON.stringify({r:r.result,note:r.note}));
    assert.equal(r.value,'','covered target must not be clicked, no value written');
    assert.match(r.note,/遮挡|covered|失败/,JSON.stringify({note:r.note}));
    console.log('PASS generic date cdp / covered target refuses to click:',r.note);
    r=await scenario(browser,{mode:'covered'});
    assert.equal(r.result.ok,true,JSON.stringify({r:r.result,note:r.note}));
    assert.equal(r.value,'2024-09-15');
    console.log('PASS generic date / same covered fixture passes with synthetic clicks (control)');

    // 25. 对照表回归：失败记录缺 observation 时报告阶段不得崩溃（实站 63/85 却整体 failed 的根因）。
    r=await scenario(browser,{mode:'day',traceCheck:true});
    assert.equal(r.traceOk,true,JSON.stringify(r.traceError||{}));
    assert.match(r.traceRow,/无弹层结构快照/);
    assert.match(r.traceRow,/VALUE_UNCONFIRMED/);
    console.log('PASS generic date / trace survives interactionResult without observation');

    await browser.close();
  }catch(error){await browser.close();throw error;}
})().catch(e=>{console.error(e);process.exitCode=1;});
