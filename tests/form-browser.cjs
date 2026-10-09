// Real content-script scanning, worker validation, filling and readback. Only model/network/Chrome storage are fixtures.
const {chromium}=require('playwright');
const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');const assert=require('node:assert/strict');const http=require('node:http');
const root=path.resolve(__dirname,'..');
const server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}fs.readFile(file,(e,b)=>{if(e){res.writeHead(404);return res.end();}res.setHeader('Content-Type',file.endsWith('.mjs')||file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(b);});});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined,headless:true,args:['--no-sandbox']});
 try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const answers={gender:'男',name:'张三',birth:'2027-06-01',phone:'13999999999',email:'invented@example.com',province:'浙江省',city:'杭州市',school1:'甲大学',major1:'机械',school2:'乙大学',major2:'计算机',company1:'甲公司',role1:'工程师',company2:'乙公司',role2:'研究员',project:'规划系统',description:'完成开发'};
 await page.exposeFunction('workerFill',async message=>{
  assert.ok(message.resumeFields.every(f=>String(f.value ?? '').trim()),'empty catalogue slots must not be sent to the model');
  assert.ok(message.resumeFields.every(f=>f.value!=='未核对候选电话'),'待核对提取值不能进入匹配请求');
  const ctx={importScripts(){},ResumeProAIHelpers:require('../ai-helpers'),AbortController,TextEncoder,setTimeout,clearTimeout,performance,fetch:async()=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(message.formFields.map(f=>({fieldId:f.fieldId,value:answers[f.idAttr]})).filter(m=>m.value))}}]})})};ctx.self=ctx;
  vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(root,'ai-worker.js'),'utf8'),ctx);
  const result=await ctx.handleAiFill(message); if(process.env.DEBUG_FILL)console.log(JSON.stringify({fields:message.formFields,result})); return result;
 });
 await page.goto(`http://127.0.0.1:${server.address().port}/tests/fixtures/fill-accuracy.html`);
 await page.evaluate(()=>{
  self.__RESUME_PRO_TEST__=true;
  const host=document.createElement('div');host.id='resume-pro-sidebar';document.body.append(host);
  const store={templates:[{id:'t',name:'测试',groups:[{name:'基本信息',fields:[{key:'未提供的空字段',value:'  '},{key:'电话',value:'未核对候选电话',review:{status:'pending'}},{key:'姓名',value:'张三'},{key:'性别',value:'男'},{key:'毕业时间',value:'2027-06-01'}]},{name:'经历',fields:['甲大学','机械','乙大学','计算机','甲公司','工程师','乙公司','研究员','规划系统','完成开发','浙江省','杭州市'].map((value,i)=>({key:'资料'+i,value}))}]}],activeTemplateId:'t',aiConfig:{apiUrl:'https://fixture.invalid/v1/chat/completions',model:'fixture',apiKey:'fixture'}};
  self.chrome={runtime:{id:'fixture',getURL:p=>new URL('/'+p,location).href,sendMessage:async m=>m.type==='AI_FILL'?workerFill(m):{ready:true}},storage:{local:{get:async()=>structuredClone(store),set:async v=>Object.assign(store,v)},onChanged:{addListener(){}}}};
  self.fixtureStore=store;
 });
 for(const script of JSON.parse(fs.readFileSync(path.join(root,'manifest.json'))).content_scripts[0].js)await page.addScriptTag({path:path.join(root,script)});
 await page.evaluate(async()=>{
  const api=ResumeProHighlightTest;api.setCurrentStore(fixtureStore);
  const panel=document.getElementById('resume-pro-sidebar').attachShadow({mode:'open'});panel.innerHTML='<button id="resume-pro-ai-fill">填写</button><div id="resume-pro-status"></div>';api.setShadowRoot(panel);
  self.scannedBefore=api.scanFillableFields().fields;
  await api.handleAiFillClick({currentTarget:panel.querySelector('button')});
 });
 const actual=await page.locator('input,select').evaluateAll(es=>Object.fromEntries(es.map(e=>[e.id,e.value])));
 if(process.env.DEBUG_FILL)console.log(await page.evaluate(()=>document.getElementById('resume-pro-sidebar').shadowRoot.textContent), await page.evaluate(()=>scannedBefore));
 assert.deepEqual(actual,{gender:'m',name:'用户手填姓名',birth:'',phone:'',email:'',province:'浙江省',city:'杭州市',school1:'甲大学',major1:'机械',school2:'乙大学',major2:'计算机',company1:'甲公司',role1:'工程师',company2:'乙公司',role2:'研究员',project:'规划系统',description:'完成开发'});
 const status=await page.evaluate(()=>document.getElementById('resume-pro-sidebar').shadowRoot.querySelector('#resume-pro-status').textContent);
 assert.match(status,/已填写 13 个字段/);
 assert.doesNotMatch(status,/填写失败|被页面顶掉/);
 const fields=await page.evaluate(()=>scannedBefore);
 assert.equal(fields.find(f=>f.idAttr==='school1').recordIndex,1);
 assert.equal(fields.find(f=>f.idAttr==='school2').recordIndex,2);
 assert.equal(fields.find(f=>f.idAttr==='company1').group,'工作经历');
 // A controlled input that discards changes must be reported as drift, never success.
 const drift=await page.evaluate(async()=>{
  const api=ResumeProHighlightTest;const el=document.querySelector('#description');el.value='';
  el.addEventListener('change',()=>{const copy=el.cloneNode();copy.value='';el.replaceWith(copy)},{once:true});
  const scan=api.scanFillableFields();const meta=scan.fields.find(f=>f.idAttr==='description');const entry=scan.fieldMap.get(meta.fieldId);
  await api.setElementValue(entry,'被丢弃的值');const outcomes=new Map();const result=await api.verifyWrittenValues(new Map([[meta.fieldId,{entry,meta,value:'被丢弃的值',label:'项目描述'}]]),outcomes);
  return {drift:result.drift,value:document.querySelector('#description').value,ok:outcomes.get(meta.fieldId).ok};
 });
 assert.deepEqual(drift,{drift:1,value:'',ok:false});
 const diagnostic=await page.evaluate(()=>{
  const api=ResumeProHighlightTest,select=document.createElement('select');select.innerHTML='<option value="男">男</option>';
  return {detachedValid:api.verifyFilledValue({kind:'element',element:select},'男','select'),name:api.reviewFieldName({fieldId:'field-9',label:'请选择',inputType:'select',group:'教育经历',recordIndex:2})};
 });
 assert.equal(diagnostic.detachedValid,false);assert.match(diagnostic.name,/教育经历.*第 2 条.*field-9/);assert.doesNotMatch(diagnostic.name,/请选择/);
 const sourceSummary=await page.evaluate(()=>{
  const api=ResumeProHighlightTest;
  const fields=[{fieldId:'ok',label:'姓名',group:'个人信息'},
   {fieldId:'blocked',label:'掌握程度',group:'语言能力',sourceRejection:'没有本语种明确的能力水平来源',sourceRejectionValue:'良好'},
   {fieldId:'missing',label:'学历',group:'教育经历'}];
  const matches=[{fieldId:'ok',source:'local',resumeKey:'姓名',value:'示例用户'}];
  const common={fields,fieldMap:new Map(),matches,outcomes:new Map([['ok',{ok:true}]])};
  const blocked=api.formatFieldTrace(common);
  const recovered=api.formatFieldTrace({...common,matches:[...matches,{fieldId:'blocked',source:'local',resumeKey:'听说能力',value:'良好'}],outcomes:new Map([['ok',{ok:true}],['blocked',{ok:true}]])});
  const failed=api.formatFieldTrace({...common,fields:[fields[0]],outcomes:new Map([['ok',{ok:false}]])});
  return {blocked,recovered,failed};
 });
 assert.match(sourceSummary.blocked,/1 个字段被来源校验拦截，未写入/);assert.match(sourceSummary.blocked,/另有 1 个字段未给出值/);
 assert.doesNotMatch(sourceSummary.blocked,/没有发现|已写入的字段未发现/);
 assert.doesNotMatch(sourceSummary.recovered,/被来源校验拦截|来源校验拦截（/,'安全来源补成功后不继续提示该字段被拦截');
 assert.match(sourceSummary.failed,/1 个字段未完成填写/);assert.doesNotMatch(sourceSummary.failed,/未发现/);
// Phoenix class family from diagnostics: claim its input once and recover the field label.
 const phoenix=await page.evaluate(()=>{
  const host=document.createElement('div');host.innerHTML='<div class="title">基本信息</div><div><label>民族</label><div class="phoenix-select__cont"><div class="phoenix-select__inputWrapper"><input class="phoenix-select__input" placeholder="请选择"></div></div></div>';document.body.append(host);
  const scan=ResumeProHighlightTest.scanFillableFields();const root=host.querySelector('.phoenix-select__cont');
  const matches=scan.fields.filter(f=>{const e=scan.fieldMap.get(f.fieldId);return e.root===root||e.element===root.querySelector('input')});
  const result=matches.map(f=>({label:f.label,kind:scan.fieldMap.get(f.fieldId).kind}));host.remove();return result;
 });
 assert.deepEqual(phoenix,[{label:'民族',kind:'combobox'}]);
 const ranges=await page.evaluate(async()=>{
  const api=ResumeProHighlightTest,host=document.createElement('section');
  host.innerHTML='<h2>项目经历</h2><label>起止时间</label><div class="date-range-test"><span><input id="range-start" placeholder="开始日期"></span><span>~</span><span><input id="range-end" placeholder="结束日期"></span></div>';document.body.append(host);
  const scan=api.scanFillableFields();const fields=scan.fields.filter(f=>f.idAttr.startsWith('range-'));
  const pairs=fields.map(f=>({label:f.label,role:f.rangeRole,id:f.rangeId}));
  const start=fields.find(f=>f.rangeRole==='start'),end=fields.find(f=>f.rangeRole==='end');
  const entry=scan.fieldMap.get(start.fieldId);entry.meta=start;entry.decide=async()=>({id:'write'});
  const filled=await api.fillDateWithAgent(entry,'2026-01-01',start);
  document.querySelector('#range-start').value='2026-09-01';document.querySelector('#range-end').value='2026-01-01';
  const outcomes=new Map();const verified=await api.verifyWrittenValues(new Map(fields.map(f=>[f.fieldId,{entry:scan.fieldMap.get(f.fieldId),meta:f,value:document.getElementById(f.idAttr).value,inputType:f.inputType,label:f.label}])),outcomes);
  host.remove();return {pairs,filled:Boolean(filled&& (typeof filled!=='object'||filled.ok)),drift:verified.drift,valid:api.validDateOrder('2026-2','2026-10')};
 });
 assert.equal(ranges.pairs.length,2);assert.equal(ranges.pairs[0].role,'start');assert.equal(ranges.pairs[1].role,'end');assert.equal(ranges.pairs[0].id,ranges.pairs[1].id);
 assert.equal(ranges.filled,true);assert.equal(ranges.drift,2);assert.equal(ranges.valid,true);
 const sections=await page.evaluate(()=>{
  const host=document.createElement('form');host.innerHTML='<nav><h2>工作经历</h2></nav><div><h2>基本信息</h2><label>姓名<input id="scope-name"></label></div><div><h2>获奖经历</h2><label>获奖名称<input id="scope-award"></label></div><div><h2>项目经历</h2><label>项目名称<input id="scope-project"></label></div>';document.body.append(host);
  const result=ResumeProHighlightTest.scanFillableFields().fields.filter(f=>f.idAttr.startsWith('scope-')).map(f=>f.group);host.remove();return result;
 });
 assert.deepEqual(sections,['基本信息','获奖经历','项目经历']);
 // One hidden storage input with two visible date endpoints; award rows after projects.
 const period=await page.evaluate(async()=>{
  const host=document.createElement('div');host.innerHTML='<h3>项目经历</h3><div class="atsx-form-item"><label>起止时间</label><div class="atsx-date-picker atsx-date-picker-period-month"><input class="atsx-date-picker-period-hidden-input" style="width:0;opacity:0"><span>YYYY-MM</span><span>YYYY-MM</span></div></div><div><div><label>获奖名称</label><input><label>获奖时间</label><input placeholder="YYYY"><label>描述</label><textarea></textarea></div><div><label>获奖名称</label><input><label>获奖时间</label><input placeholder="YYYY"><label>描述</label><textarea></textarea></div></div>';document.body.append(host);
  const api=ResumeProHighlightTest,scan=api.scanFillableFields();
  const fields=scan.fields.filter(f=>host.contains(scan.fieldMap.get(f.fieldId)?.element));
  const dates=fields.filter(f=>f.rangeId?.startsWith('period-'));
  const node=scan.fieldMap.get(dates[0].fieldId).element;
  node.onclick=()=>{const panel=document.createElement('div');panel.className='atsx-calendar-picker-container';panel.innerHTML='<div class="atsx-calendar-month-panel"><span class="atsx-calendar-month-panel-year-select">2025年</span><table><tr><td class="atsx-calendar-month-panel-cell" title="三月">三月</td></tr></table></div>';document.body.append(panel);panel.querySelector('td').onclick=()=>{node.textContent='2025-03';panel.remove();};};
  const result=await api.setElementValue(scan.fieldMap.get(dates[0].fieldId),'2025-03');
  const output={dates:dates.map(f=>[f.label,f.rangeRole]),hidden:fields.some(f=>scan.fieldMap.get(f.fieldId)?.element.matches('.atsx-date-picker-period-hidden-input')),awards:fields.filter(f=>f.recordSignature?.includes('获奖名称')).map(f=>f.group),ok:result.ok,reason:result.reason,end:scan.fieldMap.get(dates[1].fieldId).element.textContent};host.remove();return output;
 });
 assert.deepEqual(period.dates,[['开始时间','start'],['结束时间','end']]);assert.equal(period.hidden,false);assert.equal(period.ok,true,JSON.stringify(period));assert.equal(period.end,'YYYY-MM');assert.equal(period.awards.length,6);assert.ok(period.awards.every(g=>g==='获奖经历'));
 const yearResult=await page.evaluate(async()=>{
  const root=document.createElement('div');root.className='atsx-date-picker';root.innerHTML='<input readonly placeholder="YYYY">';document.body.append(root);const input=root.firstChild;
  input.onclick=()=>{const panel=document.createElement('div');panel.className='atsx-calendar-picker-container';panel.innerHTML='<table><tr><td class="atsx-calendar-year-panel-cell">2024</td></tr></table>';document.body.append(panel);panel.querySelector('td').onclick=()=>{input.value='2024';panel.remove();};};
  const result=await ResumeProHighlightTest.setElementValue({kind:'element',element:input,pickerRoot:root},'2024');root.remove();return result;
 });assert.equal(yearResult.ok,true,JSON.stringify(yearResult));
 // Simulated Ant calendar: unrelated visible portal, async mount, header replacement and month-only cells.
 const calendars=await page.evaluate(async()=>{
  const results=[];
  for(const mode of ['month','day','discard']){
   const host=document.createElement('div');host.innerHTML='<div class="ant-calendar-picker"><input readonly placeholder="请选择日期"></div><div class="ant-calendar-picker-container" id="other-calendar"><button>不要点击</button></div>';document.body.append(host);
   const input=host.querySelector('input');let wrong=0;host.querySelector('button').onclick=()=>wrong++;
   let year=2026;let active;
   input.onclick=()=>setTimeout(()=>{
    const render=()=>{
     const panel=document.createElement('div');panel.className='ant-calendar-picker-container';panel.id='active-calendar';
     if(mode==='day')panel.innerHTML='<span class="ant-calendar-year-select">2026年</span><span class="ant-calendar-month-select">1月</span><table><tr><td class="ant-calendar-cell" title="2026年1月2日">2</td></tr></table>';
     else panel.innerHTML=`<div class="ant-calendar-month-panel"><button class="ant-calendar-month-panel-prev-year-btn">上一年</button><span class="ant-calendar-month-panel-year-select">${year}年</span><table><tr><td class="ant-calendar-month-panel-cell" title="三月">三月</td></tr></table></div>`;
     if(active)active.replaceWith(panel);else document.body.append(panel);active=panel;input.setAttribute('aria-controls',panel.id);
     panel.querySelector('button')?.addEventListener('click',()=>{year--;setTimeout(render,100)});
     panel.querySelector('td').onclick=()=>{if(mode!=='discard'){input.value=mode==='day'?'2026-01-02':`${year}-03`;panel.remove();}};
    };render();
   },180);
   const entry={kind:'element',element:input,pickerType:'antd',pickerInputType:mode==='day'?'date':'month'};
   const result=await ResumeProHighlightTest.setElementValue(entry,mode==='day'?'2026-01-02':'2024-03');
   results.push({mode,ok:result.ok,value:input.value,wrong,reason:result.reason||'',actions:entry.interactions?.map(i=>i.action)});
   active?.remove();host.remove();
  }
  return results;
 });
 assert.equal(calendars[0].ok,true);assert.equal(calendars[0].value,'2024-03');assert.ok(calendars[0].actions.includes('日历翻页'));
 assert.equal(calendars[1].ok,true);assert.equal(calendars[1].value,'2026-01-02');
 assert.equal(calendars[2].ok,false);assert.match(calendars[2].reason,/未保留/);
 assert.ok(calendars.every(r=>r.wrong===0));



assert.deepEqual(errors,[]);
 await page.setContent(fs.readFileSync(path.join(root,'tests/fixtures/mapping-identity.html'),'utf8'));
 const mappedValues=await page.evaluate(async()=>{
  const api=ResumeProHighlightTest;const structure=ResumeProFormStructure;
  const scan=api.scanFillableFields();const fields=scan.fields.filter(f=>f.idAttr);
  const resumeFields=fields.map((f,i)=>({group:f.group,groupId:'g'+f.group,recordId:'r'+i,fieldId:'f'+i,key:'开始时间',value:`202${i}-01-01`}));
  const entries=fields.map((f,i)=>({...f,groupSignature:f.recordSignature,resumeGroup:f.group,resumeGroupId:resumeFields[i].groupId,resumeRecordId:resumeFields[i].recordId,resumeFieldId:resumeFields[i].fieldId,resumeKey:'开始时间'}));
  const snapshot=structure.applyMappingEntries({fields:[]},entries).snapshot;
  const ambiguous=api.mappingMatches({fields:[fields[0],{...fields[0],fieldId:'duplicate'}],snapshot,resumeFields}).matches.length;
  const matched=api.mappingMatches({fields,snapshot,resumeFields});
  for(const match of matched.matches)await api.setElementValue(scan.fieldMap.get(match.fieldId),match.value);
  return {ambiguous,count:matched.matches.length,values:fields.map(f=>document.getElementById(f.idAttr).value)};
 });
 assert.deepEqual(mappedValues,{ambiguous:0,count:4,values:['2020-01-01','2021-01-01','2022-01-01','2023-01-01']});
 const cachedLevels=await page.evaluate(()=>{
  const api=ResumeProHighlightTest,structure=ResumeProFormStructure;
  const fields=[1,2].map(i=>({fieldId:'level'+i,label:'学历',group:'教育经历',recordIndex:i,inputType:'combobox'}));
  const global={group:'基本信息',groupId:'basic',recordId:'personal',fieldId:'global',key:'最高学历',value:'硕士'};
  const snapshotFor=source=>structure.applyMappingEntries({fields:[]},fields.map(f=>({...f,resumeGroup:source.group,resumeGroupId:source.groupId,resumeRecordId:source.recordId,resumeFieldId:source.fieldId,resumeKey:source.key}))).snapshot;
  const cached=api.mappingMatches({fields,snapshot:snapshotFor(global),resumeFields:[global]});
  const degree={...global,group:'教育经历',groupId:'education',recordId:'bachelor',key:'学位',value:'学士'};
  const wrongPurpose=api.mappingMatches({fields,snapshot:snapshotFor(degree),resumeFields:[degree]}).matches.length;
  const own={...degree,key:'学历',value:'本科'};
  const ownHit=api.mappingMatches({fields:fields.slice(0,1),snapshot:snapshotFor(own),resumeFields:[own]}).matches;
  return {global:cached.matches.length,answered:cached.answered.size,wrongPurpose,own:ownHit.map(m=>m.value)};
 });
 assert.deepEqual(cachedLevels,{global:0,answered:0,wrongPurpose:0,own:['本科']},'cached highest education cannot bypass row provenance or convert a degree into a level');
 // The page collection entry point offers a stop button while AI is still pending.
 await page.evaluate(()=>{
  const host=document.createElement('div');host.id='resume-pro-sidebar';document.body.append(host);
  const panel=host.attachShadow({mode:'open'});panel.innerHTML='<button id="resume-pro-collect-fill">采集到资料树</button><div id="resume-pro-status"></div>';
  ResumeProHighlightTest.setShadowRoot(panel);
  chrome.runtime.sendMessage=async m=>m.type==='RESUME_COLLECT'?{success:true,added:1,ids:['p']}:{opened:true};
  ResumeProCollectionAI.organize=async(id,ids,{signal,onProgress})=>{
   onProgress(75);return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('已停止等待 AI 归纳，原始内容已保留。')),{once:true}));
  };
  self.collectionRun=ResumeProHighlightTest.handleCollectFillClick({currentTarget:panel.querySelector('button')});
 });
 await page.getByText('AI 正在归纳，已等待 75 秒。模型仍未返回，可继续等待或停止等待。',{exact:true}).waitFor();
 await page.getByRole('button',{name:'停止等待 AI 归纳',exact:true}).click();
 await page.evaluate(()=>self.collectionRun);
 assert.equal(await page.getByRole('button',{name:'停止等待 AI 归纳',exact:true}).count(),0);
 assert.equal(await page.locator('#resume-pro-collect-fill').isEnabled(),true);
 console.log('PASS: placeholder select, protected manual value, birthday/contact source guard, async cascade with node replacement, repeated records, rerender before/after write, discarded-write detection');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1});
