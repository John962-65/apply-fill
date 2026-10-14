// Exercise production scanner/worker/fill/final verification with real CDP inputs.
// Anonymous controls preserve the screenshot's editable suggestions, not a site's private DOM.
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),H=require('../ai-helpers');
const fact=(id,recordId,label,value)=>({id,recordId,label,key:recordId+'-'+label,value});
const period=[['2024-09','2027-06'],['2020-09','2024-06']],awardDates=['2022-12','2024-09'];
const store={templates:[{id:'t',name:'Anonymous autocomplete',groups:[
 {id:'personal',name:'个人信息',records:[{id:'person',name:'本人'}],fields:[fact('name','person','姓名','匿名候选人')]},
 {id:'education',name:'教育经历',records:[{id:'e1',name:'研究生教育'},{id:'e2',name:'本科教育'}],fields:period.flatMap(([start,end],i)=>{const n=i+1,r='e'+n;return [fact('school-'+n,r,'学校名称','示例大学'),fact('major-'+n,r,'专业',n===1?'机械电子工程':'交通设备与控制工程'),fact('level-'+n,r,'学历',n===1?'硕士':'学士'),fact('start-'+n,r,'开始时间',start),fact('end-'+n,r,'结束时间',end)];})},
 {id:'awards',name:'获奖经历',records:[{id:'a1',name:'奖学金甲'},{id:'a2',name:'奖学金乙'}],fields:awardDates.flatMap((date,i)=>{const n=i+1,r='a'+n;return [fact('award-'+n+'-name',r,'获奖名称','奖学金'+n),fact('award-'+n+'-date',r,'获奖时间',date),fact('award-'+n+'-level',r,'奖项级别','校级')];})},
 {id:'g-summary',name:'自我评价',records:[],fields:[fact('summary','','自我评价','乐于学习与团队合作。')]}
 ]}],activeTemplateId:'t',aiConfig:{apiUrl:'https://fixture.invalid/api',model:'fixture',apiKey:'fixture'}};
function modelMatches(message){
 const facts=new Map(message.resumeFields.map(f=>[f.fieldId,f]));
 return message.formFields.flatMap(f=>{
  let source=f.idAttr==='person-name'?'name':f.idAttr;
  let m=f.idAttr.match(/^education-(\d+)-(start|end)-(year|month)$/);
  if(m)source=m[2]+'-'+m[1];
  m=f.idAttr.match(/^award-(\d+)-point-(year|month)$/);if(m)source='award-'+m[1]+'-date';
  const original=facts.get(source);if(!original)return [];
  return [{fieldId:f.fieldId,value:f.datePart?H.datePartValue(original.value,f.datePart):original.value,sourceId:source}];
 });
}
(async()=>{
 const {performInput}=await import('../browser-input.mjs');
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH,args:['--no-sandbox']});
 try{
  for(const mode of process.env.AUTOCOMPLETE_MODES?.split(',')||['normal','div-list','preopened','rerender','dynamic','dynamic-rerender','hover-replace','no-token','manual','no-choice','duplicate','discard','late-discard','manual-query','blocked']){
   const page=await browser.newPage({viewport:{width:1100,height:950}}),errors=[],inputKinds=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route('https://fixture.invalid/**',r=>r.fulfill({contentType:'text/html',body:fs.readFileSync(path.join(__dirname,'fixtures/autocomplete-resume.html'),'utf8')}));
   const cdp=await page.context().newCDPSession(page);
   await page.exposeFunction('realInput',action=>{inputKinds.push(action.kind);return performInput((m,p)=>cdp.send(m,p),action).catch(e=>({ok:false,error:e.message,errorCode:e.code}));});
   await page.exposeFunction('workerFill',async message=>{
    const w={importScripts(){},ResumeProAIHelpers:H,AbortController,TextEncoder,performance,setTimeout,clearTimeout,fetch:async()=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(modelMatches(message))}}]})})};w.self=w;vm.createContext(w);vm.runInContext(fs.readFileSync(path.join(root,'ai-worker.js'),'utf8'),w);return JSON.parse(JSON.stringify(await w.handleAiFill(message)));
   });
   await page.goto('https://fixture.invalid/form?mode='+mode);
   await page.evaluate(store=>{
    self.__RESUME_PRO_TEST__=true;self.fixtureStore=store;
    const host=document.createElement('div');host.id='resume-pro-sidebar';document.body.append(host);
    self.chrome={runtime:{id:'fixture',getManifest:()=>({version:'test'}),getURL:()=>'',sendMessage:async m=>{
     if(m.type==='BROWSER_INPUT')return realInput(m.action);if(m.type==='AI_FILL')return workerFill(m);
     if(m.type==='AI_INTERACTION_STEP')return {success:true,action:{id:(m.observation.candidates.find(c=>c.kind==='choose'&&c.label===m.observation.levelTarget)||m.observation.candidates.find(c=>c.kind==='open')||m.observation.candidates.find(c=>c.kind==='search')||m.observation.candidates.find(c=>c.kind==='stop')).id}};
     return {ready:true};
    }},storage:{local:{get:async()=>structuredClone(fixtureStore),set:async changes=>Object.assign(fixtureStore,changes)},onChanged:{addListener(){}}}};
   },structuredClone(store));
   for(const script of JSON.parse(fs.readFileSync(path.join(root,'manifest.json'))).content_scripts[0].js)await page.addScriptTag({path:path.join(root,script)});
   const result=await page.evaluate(async()=>{
    const api=ResumeProHighlightTest,shadow=document.getElementById('resume-pro-sidebar').attachShadow({mode:'open'});
    shadow.innerHTML='<button id="resume-pro-ai-fill">填写</button><input id="resume-pro-browser-input" type="checkbox" checked><div id="resume-pro-status"></div><details id="resume-pro-trace"><textarea id="resume-pro-trace-text"></textarea></details>';
    fixtureStore.templates=fixtureStore.templates.map(ResumeProTree.normalizeTemplate);const before=structuredClone(fixtureStore.templates);
    api.setCurrentStore(fixtureStore);api.setShadowRoot(shadow);const scan=api.scanFillableFields();
    await api.handleAiFillClick({currentTarget:shadow.querySelector('button')});
    const after=api.scanFillableFields(),school=after.fields.find(f=>f.idAttr==='school-1'),entry=after.fieldMap.get(school.fieldId);
    return {fields:scan.fields,status:shadow.querySelector('#resume-pro-status').textContent,trace:shadow.querySelector('textarea').value,stats,submitted:submittedValues(),queries:Object.fromEntries([...document.querySelectorAll('main input:not([type=hidden])')].map(n=>[n.id,n.value])),open:document.querySelectorAll('[data-fixture-menu]').length,schoolKind:entry.kind,schoolRead:api.readBackValue(entry),schoolVerified:api.verifyFilledValue(entry,'示例大学','combobox'),collected:api.readFilledFields(),before,after:fixtureStore.templates};
   });
   assert.equal(result.fields.length,24,JSON.stringify(result.fields));
   assert.equal(result.stats.wrong+result.stats.add+result.stats.submit+result.stats.untrusted,0,JSON.stringify(result.stats));
   assert.deepEqual(result.before,result.after);assert.deepEqual(errors,[]);
   if(mode!=='blocked')assert.equal(result.open,0,JSON.stringify(result));
   if(['normal','div-list','preopened','rerender','dynamic','dynamic-rerender','hover-replace','no-token'].includes(mode)){
    assert.match(result.status,/已填写 24 个字段/,JSON.stringify(result));
    assert.equal(result.schoolKind,'combobox');assert.equal(result.schoolVerified,true);
    assert.equal(result.queries['school-1'],'示例大学');assert.equal(result.queries['major-2'],'交通设备与控制工程');
    if(mode!=='no-token')assert.equal(result.submitted['school-1-selected'],'school-1-choice-0');
    assert.equal(result.submitted['major-2-selected'],'major-2-choice-0');
    assert.equal(result.queries['level-1'],'硕士研究生');assert.equal(result.queries['level-2'],'本科');
    for(let n=1;n<=2;n++)for(const edge of ['start','end']){const [y,m]=period[n-1][edge==='start'?0:1].split('-');assert.equal(result.queries[`education-${n}-${edge}-year`],y+'年');assert.equal(result.queries[`education-${n}-${edge}-month`],Number(m)+'月');}
    assert.ok(result.stats.maxOpen<=1,JSON.stringify({mode,stats:result.stats,trace:result.trace}));
    if(mode==='normal')assert.ok(!inputKinds.includes('key'),'naturally committed selections must not receive a forced Escape');
    if(mode.includes('rerender'))assert.equal(result.stats.replacements,20);
    if(mode==='hover-replace'){assert.equal(result.stats.hoverReplaced,1);assert.match(result.trace,/重新观察/);}
    console.log('PASS autocomplete full form, real selected IDs + closed popups:',mode);
   }else if(mode==='manual'){
    assert.equal(result.submitted['school-1-selected'],'manual-school-id');assert.equal(result.queries['school-1'],'人工填写的学校');assert.ok(!result.stats.opened.some(n=>n.id==='school-1'));
    // This manual school is absent from the resume. Preserve it and stop the
    // remaining record-dependent values, instead of borrowing another school row.
    assert.match(result.status,/已填写 17 个字段/);assert.match(result.trace,/网页已有记录/);
    for(const edge of ['start','end'])for(const part of ['year','month'])assert.equal(result.queries[`education-1-${edge}-${part}`],'');
    console.log('PASS confirmed manual choice preserved:',mode);
   }else if(mode==='blocked'){
    assert.equal(result.queries['person-name'],'匿名候选人');assert.equal(result.queries.summary,'乐于学习与团队合作。');assert.equal(result.stats.selected.length,0);
    assert.match(result.trace,/局部继续/);assert.match(result.trace,/局部跳过/);assert.match(result.status,/已填写 4 个字段/);
    console.log('PASS unclosed local popup defers complex controls and permits only proven independent text:',mode);
   }else{
    assert.equal(result.submitted['school-1-selected'],'');assert.equal(result.schoolRead,'');assert.equal(result.schoolVerified,false);assert.ok(!result.collected.some(f=>f.value==='示例大学'&&f.recordIndex===1));
    if(mode==='manual-query')assert.equal(result.queries['school-1'],'待核对学校');
    assert.doesNotMatch(result.trace,/学校名称 → 已写入.*school-1/);assert.match(result.status,/已填写 23 个字段/);
    console.log('PASS uncommitted queries rejected, no nearby/add/unrelated clicks:',mode);
   }
   await page.close();
  }
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
