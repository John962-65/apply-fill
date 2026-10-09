// Observed DOM shapes + synthetic state behaviors + production prefetch/fill.
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
(async()=>{
 const {performInput}=await import('../browser-input.mjs');
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH,args:['--no-sandbox']});
 try{
  for(const mode of ['normal','sticky','discard','date-discard','reverse-nav']){
   const page=await browser.newPage({viewport:{width:1100,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
   const cdp=await page.context().newCDPSession(page);await page.exposeFunction('realInput',a=>performInput((m,p)=>cdp.send(m,p),a));
   await page.route('https://fixture.invalid/**',r=>r.fulfill({contentType:'text/html',body:fs.readFileSync(path.join(__dirname,'fixtures/feishu-ud-captured.html'),'utf8')}));
   await page.goto('https://fixture.invalid/form?mode='+mode);
   await page.evaluate(()=>{
    self.__RESUME_PRO_TEST__=true;const host=document.createElement('div');host.id='resume-pro-sidebar';document.body.append(host);
    self.facts={'姓名':'示例应聘者','手机号码':'13900000000','邮箱':'applicant@example.invalid','性别':'男','学校名称':'示例大学','学历':'硕士研究生','出生日期':'2002-05','自我评价':'示例评价'};
    self.fixtureStore={templates:[{id:'t',name:'匿名资料',groups:[{id:'g',name:'个人资料',fields:Object.entries(facts).map(([label,value],i)=>({id:'s'+i,key:label,label,value}))}]}],activeTemplateId:'t',aiConfig:{apiUrl:'https://fixture.invalid/api',model:'fixture',apiKey:'fixture'}};
    self.chrome={runtime:{id:'fixture',getManifest:()=>({version:'test'}),getURL:p=>new URL(p,location.origin).href,sendMessage:async m=>{
     if(m.type==='BROWSER_INPUT')return realInput(m.action);
     if(m.type==='AI_FILL')return {success:true,matches:m.formFields.flatMap(f=>facts[f.label]?[{fieldId:f.fieldId,value:facts[f.label],resumeKey:f.label,source:'ai'}]:[])};
     if(m.type==='AI_INTERACTION_STEP')return {success:true,action:{id:(m.observation.candidates.find(c=>c.kind==='write')||m.observation.candidates.find(c=>c.kind==='stop')).id}};
     return {ready:true};
    }},storage:{local:{get:async()=>structuredClone(fixtureStore),set:async c=>Object.assign(fixtureStore,c)},onChanged:{addListener(){}}}};
   });
   for(const script of JSON.parse(fs.readFileSync(path.join(root,'manifest.json'))).content_scripts[0].js)await page.addScriptTag({path:path.join(root,script)});
   const result=await page.evaluate(async mode=>{
    const api=ResumeProHighlightTest,h=document.getElementById('resume-pro-sidebar').attachShadow({mode:'open'});
    h.innerHTML='<button id="resume-pro-ai-fill">填写</button><div id="resume-pro-status"></div><input type="checkbox" id="resume-pro-browser-input" checked><details id="resume-pro-trace"><textarea id="resume-pro-trace-text"></textarea></details><details id="resume-pro-diagnostics"><textarea id="resume-pro-diagnostics-text"></textarea></details>';
    fixtureStore.templates=fixtureStore.templates.map(ResumeProTree.normalizeTemplate);api.setShadowRoot(h);api.setCurrentStore(fixtureStore);
    const before=structuredClone(fixtureStore.templates),scan=api.scanFillableFields(),school=scan.fields.find(f=>f.label==='学校名称');
    const recorder=ResumeProControlCapture.create();recorder.start();recorder.arm(scan.fieldMap.get(school.fieldId).trigger);
    const captured=JSON.parse(recorder.preview()).snapshots[0];recorder.stop();
    const diagnosticNodes=[];
    for(let i=0;i<12;i++){const n=document.getElementById('gender').cloneNode(true);n.removeAttribute('id');document.body.append(n);diagnosticNodes.push(n);}
    for(const range of [false,true]){const n=document.createElement('div');n.className=range?'throne-biz-date-range-picker-input':'ud__picker';n.innerHTML='<input placeholder="YYYY-MM">';document.body.append(n);diagnosticNodes.push(n);}
    const diagnostic=ResumeProControlCatalog.sampleTargets(diagnosticNodes.map((node,i)=>({node,control:i<12?'combobox':'date-picker',label:'不同字段'+i,labelSafe:true})),7)
      .map(t=>t.node.className);diagnosticNodes.forEach(n=>n.remove());
    const initial={labels:scan.fields.map(f=>f.label),schoolPanel:Boolean(api.comboAgent.panel(scan.fieldMap.get(school.fieldId))),schoolTrigger:scan.fieldMap.get(school.fieldId).trigger.id,
     bare:document.elementFromPoint(20,20)===document.body,fieldContext:captured.fieldContext?.attrs.class,panels:recorder.panels().length,diagnostic};
    if(['normal','sticky'].includes(mode)){
     await api.handleAiFillClick({currentTarget:h.querySelector('button')});
     return {initial,status:h.querySelector('#resume-pro-status').textContent,trace:h.querySelector('textarea').value,diagnostics:h.querySelector('#resume-pro-diagnostics-text').value,
      values:Object.fromEntries(['name','phone','email','school','birth','summary'].map(id=>[id,document.getElementById(id).value])),
      gender:document.getElementById('gender').querySelector('.ud__select__selector__selectItem').textContent,
      degree:document.getElementById('degree').querySelector('.ud__select__selector__selectItem').textContent,
      stats,open:Array.from(document.querySelectorAll('.ud__select__dropdown,.ud__picker-dropdown')).filter(n=>getComputedStyle(n).display!=='none').length,
      before,after:fixtureStore.templates};
    }
    const f=scan.fields.find(f=>f.label===(mode==='discard'?'学校名称':'出生日期')),e=scan.fieldMap.get(f.fieldId);e.meta=f;
    const filled=await api.setElementValue(e,mode==='discard'?'示例大学':'2002-05');
    return {initial,filled,read:api.readBackValue(e),note:e.fillNote,stats,collected:api.readFilledFields()};
   },mode);
   assert.equal(result.initial.schoolPanel,false,'the input dropdown-open wrapper is never a popup');
   assert.equal(result.initial.schoolTrigger,'school');assert.equal(result.initial.bare,false,'dense page requires an inert local label');
   assert.match(result.initial.fieldContext,/ud-formily-item-control-align-left/);assert.equal(result.initial.panels,0,'open-state wrappers do not count as captured popups');
   assert.ok(result.initial.diagnostic.includes('ud__picker')&&result.initial.diagnostic.includes('throne-biz-date-range-picker-input'),'repeated dropdown labels must leave a slot for each distinct date shape');
   assert.deepEqual(result.initial.labels,['姓名','手机区号','手机号码','邮箱','性别','学校名称','学历','出生日期','自我评价']);
   assert.equal(result.stats.submissions,0);assert.equal(result.stats.untrusted,0);assert.deepEqual(errors,[]);
   if(mode==='normal'){
    assert.match(result.status,/已填写 8 个字段/,JSON.stringify(result));assert.doesNotMatch(result.trace,/未完成填写|尚未尝试|没写进去|没有任何标签/);
    assert.deepEqual(result.values,{name:'示例应聘者',phone:'13900000000',email:'applicant@example.invalid',school:'示例大学',birth:'2002-05',summary:'示例评价'});
    assert.equal(result.gender,'男');assert.equal(result.degree,'硕士研究生');assert.equal(result.open,0);assert.deepEqual(result.before,result.after);
    assert.ok(result.stats.dismissed>=3,'prefetch must actually dismiss the owned list');
   }else if(mode==='sticky'){
    assert.match(result.trace,/尚未尝试/);assert.doesNotMatch(result.trace,/写了但页面没认|8 个字段未完成填写/);
    assert.match(result.diagnostics,/尚未尝试：8/);assert.match(result.diagnostics,/没填上：0/);
    assert.equal(result.values.name,'');assert.equal(result.values.summary,'');assert.ok(result.open>0);assert.deepEqual(result.before,result.after);
   }else if(mode==='discard'){
    assert.equal(result.filled,false);assert.equal(result.read,'');assert.ok(!result.collected.some(f=>f.label==='学校名称'&&f.value==='示例大学'));
   }else{
    assert.equal(result.filled.ok,false);assert.equal(result.read,'');
    assert.ok(!result.collected.some(f=>f.label==='出生日期'&&f.value==='2002-05'));
    if(mode==='reverse-nav')assert.match(result.note,/未按目标方向/);
   }
   console.log('PASS captured UD shape / full prefetch-fill / commit proof:',mode);await page.close();
  }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
