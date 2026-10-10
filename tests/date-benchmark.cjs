// 四组对照基准：同一组未知日期控件 × 四种驱动策略。
// A 原有适配器 / B 通用分类器规则（0 模型调用）/ C 纯 AI 逐步（脚本化正确决策）/ D 规则优先+接管。
// C 组用脚本化决策只验证"执行器在正确决策下能完成任务"；真实模型的测量协议见 docs/generic-date-agent.md。
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const FIXTURE=fs.readFileSync(path.join(__dirname,'fixtures/unknown-date-picker.html'),'utf8');
const POLICY=`(observation)=>{
  const c=observation.candidates||[],panel=observation.panel||{};
  const parts=String(observation.target||'').split('-').map(Number);
  const y=parts[0],m=parts[1]||null,d=parts[2]||null;
  const modes=panel.modes||[],header=panel.header||{};
  const one=kind=>c.find(x=>x.kind===kind);
  if(modes.includes('year')){
    const a=one('choose-year');
    if(a)return {id:a.id};
    const labels=(panel.grids||[]).filter(g=>g.mode==='year').flatMap(g=>g.labels).map(t=>parseInt(t,10)).filter(n=>n>=1000&&n<=9999);
    if(labels.length){
      const dir=y<Math.min(...labels)?'prev-decade':'next-decade';
      const nav=c.find(x=>x.kind==='nav'&&x.direction===dir);
      if(nav)return {id:nav.id};
    }
  }
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
  const navElement=c.find(x=>x.kind==='click-element'&&/\\d{4}/.test(x.label));
  if(navElement)return {id:navElement.id};
  return {id:(c.find(x=>x.kind==='stop')||c[0]||{}).id};
}`;
const MODES=['day','month','far','confirm','async','messy','stuckclose','time','junk'];

async function runScenario(browser,{mode,arm,target='2024-09-15'}){
  const page=await browser.newPage({viewport:{width:1100,height:900}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const cdp=await page.context().newCDPSession(page);
  await page.exposeFunction('realInput',a=>performInput((m,p)=>cdp.send(m,p),a));
  await page.route('https://fixture.invalid/**',r=>r.fulfill({contentType:'text/html',body:FIXTURE}));
  await page.goto('https://fixture.invalid/form?mode='+mode);
  await page.evaluate(()=>{
    const host=document.createElement('div');host.id='resume-pro-sidebar';document.body.append(host);
    const h=host.attachShadow({mode:'open'});
    h.innerHTML='<input type="checkbox" id="resume-pro-generic-date" checked><input type="checkbox" id="resume-pro-browser-input"><div id="resume-pro-status"></div>';
  });
  await page.evaluate(({arm,target,POLICY})=>{
    self.__RESUME_PRO_TEST__=true;
    self.modelCalls=0;
    if(arm==='A')self.__APPLY_FILL_DATE_MODE__='adapters-only';
    if(arm==='B')self.__APPLY_FILL_DATE_MODE__='agent-only';
    if(arm==='C'){self.__APPLY_FILL_DATE_MODE__='agent-only';self.__APPLY_FILL_DATE_DISABLE_CONTRACT__=true;}
    if(arm==='D')delete self.__APPLY_FILL_DATE_DISABLE_CONTRACT__;
    self.chrome={runtime:{id:'fixture',getManifest:()=>({version:'test'}),getURL:p=>location.origin+'/'+p,sendMessage:async m=>{
      if(m.type==='BROWSER_INPUT')return realInput(m.action);
      return {ready:true};
    }},storage:{local:{get:async()=>({}),set:async()=>{}},onChanged:{addListener(){}}}};
    self.__BENCH_POLICY=POLICY;self.__BENCH_TARGET=target;
  },{arm,target,POLICY});
  for(const script of JSON.parse(fs.readFileSync(path.join(root,'manifest.json'))).content_scripts[0].js)await page.addScriptTag({path:path.join(root,script)});
  const out=await page.evaluate(async ({arm,target})=>{
    const api=ResumeProHighlightTest;
    const hostShadow=document.getElementById('resume-pro-sidebar').shadowRoot;
    api.setShadowRoot(hostShadow);
    const scan=api.scanFillableFields();
    const field=scan.fields.find(f=>scan.fieldMap.get(f.fieldId).element?.id==='edu-start');
    if(!field)return {skip:true};
    const entry=scan.fieldMap.get(field.fieldId);entry.meta=field;
    if(arm==='C')entry.decide=async observation=>{self.modelCalls++;return (new Function('return '+self.__BENCH_POLICY))()(observation);};
    const started=Date.now();
    const result=await api.fillDateWithAgent(entry,target,entry.meta);
    return {ok:Boolean(result&&(typeof result!=='object'||result.ok)),value:document.getElementById('edu-start').value,
      ms:Date.now()-started,modelCalls:self.modelCalls,status:entry.interactionResult||null,note:entry.fillNote||''};
  },{arm,target});
  out.errors=errors;
  await page.close();
  return out;
}

(async()=>{
  const {performInput}=await import('../browser-input.mjs');
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH,args:['--no-sandbox']});
  try{
    const arms={A:'原适配器',B:'通用规则(0调用)',C:'纯AI逐步',D:'规则优先+接管'};
    const table={},details={};
    for(const arm of Object.keys(arms)){
      table[arm]={success:0,misfill:0,blocked:0,fail:0,ms:0,calls:0};
      details[arm]={};
      for(const mode of MODES){
        let r=await runScenario(browser,{mode,arm});
        if(r.skip){details[arm][mode]='skip';continue;}
        const expected=mode==='month'?'2024-09':'2024-09-15';
        // 误填=写进了错误的日期；值正确但面板收不起属于 BLOCKED（如实报告，不算误填）。
        const wrongDate=r.value&&r.value!==expected;
        if(r.ok)table[arm].success++;
        else if(wrongDate)table[arm].misfill++;
        else if(r.status&&r.status.status==='BLOCKED')table[arm].blocked++;
        else table[arm].fail++;
        table[arm].ms+=r.ms;table[arm].calls+=r.modelCalls;
        details[arm][mode]=`${r.ok?'成功':wrongDate?'误填':r.status&&r.status.status==='BLOCKED'?'BLOCKED':'失败'}${r.value?`(${r.value})`:''}/${r.modelCalls}次/${r.ms}ms`;
        if(r.errors.length)details[arm][mode]+=' 页面异常:'+r.errors[0];
      }
      table[arm].ms=Math.round(table[arm].ms/MODES.length);
      table[arm].calls=Math.round(table[arm].calls/MODES.length);
    }
    console.log('\n四组对照基准（9 个未知日期控件场景，资料值 2024-09-15 / 网页可能只要月精度）\n');
    console.log('| 组别 | 成功 | 误填 | BLOCKED | 失败 | 平均耗时 | 平均模型调用 |');
    console.log('|---|---|---|---|---|---|---|');
    for(const [arm,name] of Object.entries(arms)){
      const t=table[arm];
      console.log(`| ${arm} ${name} | ${t.success}/${MODES.length} | ${t.misfill} | ${t.blocked} | ${t.fail} | ${t.ms}ms | ${t.calls} |`);
    }
    console.log('\n明细（结果/模型调用/耗时）：');
    for(const [arm,name] of Object.entries(arms)){
      console.log(`  ${arm} ${name}:`);
      for(const mode of MODES)console.log(`    ${mode.padEnd(12)} ${details[arm][mode]}`);
    }
    // 消融结论的硬断言：分类器与 AI 各自的价值必须有可见差异。
    assertAblation(table,'A 在未知控件上全部失败',null,table.A.success===0);
    assertAblation(table,'B 分类器规则解出全部结构可分类场景(≥4)',null,table.B.success>=4);
    assertAblation(table,'D 混合臂与 B 至少持平（规则失败后接管）',null,table.D.success>=table.B.success);
    assertAblation(table,'C 纯 AI 在 B/D 失败的 messy 场景上成功',null,details.C.messy.startsWith('成功'));
    assertAblation(table,'D 的模型调用为 0（可分类场景全部走规则快路径）',null,table.D.calls===0);
    assertAblation(table,'没有任何一臂写进错误的日期',null,Object.values(table).every(t=>t.misfill===0));
    await browser.close();
  }catch(error){await browser.close();throw error;}
  function assertAblation(table,label,_key,condition){
    if(!condition)throw new Error('消融断言失败：'+label+' :: '+JSON.stringify(table));
    console.log('消融成立：'+label);
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
