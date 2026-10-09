// Actual worker + scanner + fill button + trusted browser input + final DOM.
// Model responses and storage are anonymous fixtures, not a signed-in website.
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH,args:['--no-sandbox']});
 try{
  const {performInput}=await import('../browser-input.mjs');
  for(const mode of ['normal','rerender','cached']){
   const page=await browser.newPage({viewport:{width:1100,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
   const cdp=await page.context().newCDPSession(page);await page.exposeFunction('realInput',a=>performInput((m,p)=>cdp.send(m,p),a));
   await page.route('https://fixture.invalid/**',r=>r.fulfill({contentType:'text/html',body:fs.readFileSync(path.join(__dirname,'fixtures/phoenix-controls.html'),'utf8')}));
   await page.exposeFunction('workerFill',async message=>{
    const facts={school:['示例大学','school-source'],degree:['工学学士','degree-source'],name:['示例奖学金','award-name'],level:['院校级','award-level'],language:['英语','lang']};
    const proposed=message.formFields.flatMap(f=>facts[f.idAttr]?[{fieldId:f.fieldId,value:facts[f.idAttr][0],sourceId:facts[f.idAttr][1]}]:[]);
    const w={importScripts(){},ResumeProAIHelpers:require('../ai-helpers'),chrome:{runtime:{onMessage:{addListener(){}}}},AbortController,TextEncoder,performance,setTimeout,clearTimeout,
     fetch:async()=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(proposed)}}]})})};
    w.self=w;vm.createContext(w);vm.runInContext(fs.readFileSync(path.join(root,'ai-worker.js'),'utf8'),w);
    const result=await w.handleAiFill(message);
    assert.equal(result.success,true);assert.equal(result.matches.length,7,JSON.stringify(result));
    return JSON.parse(JSON.stringify(result));
   });
   await page.goto('https://fixture.invalid/form');
   await page.evaluate(mode=>{
    self.mode=mode;self.__RESUME_PRO_TEST__=true;
    const text=(id,label)=>`<div class="form-item--phoenix"><label>${label}<input id="${id}"></label></div>`;
    const combo=(id,label)=>`<div class="form-item--phoenix"><div class="field-label">${label}</div><div id="${id}" class="phoenix-select"></div></div>`;
    document.querySelector('main').innerHTML=`<section><h2>教育经历</h2><article class="record">${text('school','学校名称')}${combo('education','学历')}<div class="form-item--phoenix"><label>学位<select id="degree"><option value="">请选择</option><option value="bachelor">学士</option><option>硕士</option></select></label></div></article></section>
      <section><h2>获奖经历</h2><article class="record">${text('name','获奖名称')}${combo('level','获奖级别')}</article></section>
      <section><h2>语言能力</h2>${combo('language','语言类型')}<div class="form-item--phoenix"><label>读写<select id="rw"><option value="">请选择</option><option value="good">良好</option><option>一般</option></select></label></div></section>`;
    document.getElementById('unknown')?.remove();
    for(const [id,choices] of [['education',['大学本科','硕士研究生']],['level',['院校级','国家级']],['language',['英语']]]){
     const r=document.getElementById(id);r.dataset.choices=JSON.stringify(choices);renderControl(r);
    }
    const h=document.createElement('div');h.id='resume-pro-sidebar';document.body.append(h);
    const f=(id,recordId,label,value)=>({id,recordId,label,key:recordId+'-'+label,value});
    self.fixtureStore={templates:[{id:'t',name:'匿名资料',groups:[
     {id:'e',name:'教育经历',records:[{id:'b',name:'示例大学'}],fields:[f('school-source','b','学校名称','示例大学'),f('raw-level','b','学历','学士'),f('degree-source','b','学位','工学学士')]},
     {id:'a',name:'获奖经历',records:[{id:'award','name':'示例奖学金'}],fields:[f('award-name','award','获奖名称','示例奖学金'),f('award-level','award','获奖级别','校级')]},
     {id:'l',name:'语言能力',records:[{id:'en',name:'英语'}],fields:[f('lang','en','语言','英语'),f('reading','en','阅读能力','良好'),f('writing','en','写作能力','良好')]}
    ]}],activeTemplateId:'t',aiConfig:{apiUrl:'https://fixture.invalid/api',model:'fixture',apiKey:'fixture'}};
    self.chrome={runtime:{id:'fixture',getManifest:()=>({version:'test'}),getURL:p=>new URL(p,location.origin).href,sendMessage:async m=>{
     if(m.type==='BROWSER_INPUT')return realInput(m.action);if(m.type==='AI_FILL')return workerFill(m);
     if(m.type==='AI_INTERACTION_STEP'){const s=m.observation;return {success:true,action:{id:(s.candidates.find(c=>c.kind==='choose'&&c.label===s.levelTarget)||s.candidates.find(c=>c.kind==='open')||s.candidates.find(c=>c.kind==='stop')).id}};}
     return {ready:true};
    }},storage:{local:{get:async()=>structuredClone(fixtureStore),set:async changes=>Object.assign(fixtureStore,changes)},onChanged:{addListener(){}}}};
   },mode);
   for(const script of JSON.parse(fs.readFileSync(path.join(root,'manifest.json'))).content_scripts[0].js)await page.addScriptTag({path:path.join(root,script)});
   const result=await page.evaluate(async()=>{
    const api=ResumeProHighlightTest,h=document.getElementById('resume-pro-sidebar').attachShadow({mode:'open'});
    h.innerHTML='<button id="resume-pro-ai-fill">填写</button><div id="resume-pro-status"></div><input type="checkbox" id="resume-pro-browser-input" checked><details id="resume-pro-trace"><textarea id="resume-pro-trace-text"></textarea></details>';
    fixtureStore.templates=fixtureStore.templates.map(ResumeProTree.normalizeTemplate);const before=structuredClone(fixtureStore.templates);
    api.setShadowRoot(h);api.setCurrentStore(fixtureStore);
    let cachedCount=0;
    if(self.mode==='cached'){
     const scan=api.scanFillableFields(),structure=ResumeProFormStructure;
     const sources=fixtureStore.templates.flatMap(g=>g.groups.flatMap(group=>group.fields.map(f=>({...f,fieldId:f.id,group:group.name,groupId:group.id}))));
     const ids={school:'school-source',name:'award-name',language:'lang',education:'degree-source'};
     const entries=scan.fields.flatMap(f=>{
      const source=sources.find(source=>source.fieldId===ids[f.idAttr]);
      return source?[{...f,groupSignature:f.recordSignature,resumeKey:source.key,resumeGroup:source.group,resumeGroupId:source.groupId,resumeRecordId:source.recordId,resumeFieldId:source.fieldId}]:[];
     });
     const snapshot=api.captureFormStructure({fields:scan.fields,fieldMap:scan.fieldMap,outcomes:new Map(),unlabeledCombos:0});
     const cached=structure.applyMappingEntries(snapshot,entries).snapshot;
     fixtureStore.formStructures=[cached];cachedCount=api.mappingMatches({fields:scan.fields,snapshot:cached,resumeFields:sources}).matches.length;
    }
    await api.handleAiFillClick({currentTarget:h.querySelector('button')});
    return {status:h.querySelector('#resume-pro-status').textContent,trace:h.querySelector('textarea').value,
     school:document.getElementById('school').value,degree:document.getElementById('degree').selectedOptions[0].textContent,name:document.getElementById('name').value,
     rw:document.getElementById('rw').selectedOptions[0].textContent,values,before,after:fixtureStore.templates,
     cachedCount,wrong:unrelatedClicks,untrusted:actions.filter(a=>!a.trusted).length};
   });
   assert.match(result.status,/已填写 7 个字段/,JSON.stringify(result));assert.doesNotMatch(result.status,/没填上|被来源|被页面顶掉/);
   assert.deepEqual(result.values,{education:'大学本科',level:'院校级',language:'英语'});
   assert.equal(result.degree,'学士');assert.equal(result.rw,'良好');assert.equal(result.school,'示例大学');assert.equal(result.name,'示例奖学金');
   assert.match(result.trace,/推导.*学士.*本科/);assert.match(result.trace,/推导.*阅读能力.*写作能力/);assert.match(result.trace,/同义写法.*院校级/);
   assert.deepEqual(result.after,result.before);assert.equal(result.wrong,0);assert.equal(result.untrusted,0);assert.deepEqual(errors,[]);
   if(mode==='cached')assert.equal(result.cachedCount,3,'cached identities exist, while old degree mapping waits for fresh row proof');
   console.log('PASS grounded filling, original facts unchanged, source trace and final DOM:',mode);await page.close();
  }
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
