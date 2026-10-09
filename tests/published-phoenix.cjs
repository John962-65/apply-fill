// Real Select + SelectList + UnmodeledLayer @3.3.55, scanner and CDP transport.
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),modules=path.join(__dirname,'published-phoenix/node_modules');
const esbuild=require(path.join(modules,'esbuild'));
(async()=>{
 const output=path.join(__dirname,'published-phoenix/node_modules/.fixture');fs.mkdirSync(output,{recursive:true});
 await esbuild.build({entryPoints:[path.join(__dirname,'fixtures/published-phoenix.jsx')],outfile:path.join(output,'fixture.js'),bundle:true,nodePaths:[modules],loader:{'.png':'dataurl','.svg':'dataurl','.gif':'dataurl'},define:{'process.env.NODE_ENV':'"production"'}});
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:1100,height:850}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://fixture.invalid/**',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><style>body{font:16px sans-serif;padding:30px}section{margin:30px 0}article{padding:15px;border:1px solid #ddd;margin:12px}.phoenix-form-item{margin:12px 0;width:270px}.phoenix-form-item-label-content{margin:6px}nav{position:absolute;left:800px}.common-unmodeled-layer{z-index:1200}.phoenix-selectList__singleLabel{min-width:130px}</style><div id="app"></div>'}));
  await page.goto('https://fixture.invalid/form');
  await page.addStyleTag({path:path.join(output,'fixture.css')});await page.addScriptTag({path:path.join(output,'fixture.js')});
  const cdp=await page.context().newCDPSession(page),{performInput}=await import('../browser-input.mjs');
  await page.exposeFunction('realInput',a=>performInput((m,p)=>cdp.send(m,p),a));
  await page.evaluate(()=>{
   self.__RESUME_PRO_TEST__=true;
   document.querySelectorAll('[data-test]').forEach(n=>n.querySelector('.phoenix-select').id=n.dataset.test);
   const host=document.createElement('div');host.id='resume-pro-sidebar';document.body.append(host);
   self.chrome={runtime:{id:'fixture',getManifest:()=>({version:'test'}),getURL:()=>'',sendMessage:async m=>m.type==='BROWSER_INPUT'?realInput(m.action):{}},storage:{local:{get:async()=>({}),set:async()=>{}},onChanged:{addListener(){}}}};
  });
  for(const script of JSON.parse(fs.readFileSync(path.join(root,'manifest.json'))).content_scripts[0].js)await page.addScriptTag({path:path.join(root,script)});
  const before=await page.evaluate(()=>{
   const api=ResumeProHighlightTest,shadow=document.getElementById('resume-pro-sidebar').attachShadow({mode:'open'});
   shadow.innerHTML='<input id="resume-pro-browser-input" type="checkbox" checked>';api.setShadowRoot(shadow);
   window.scan=api.scanFillableFields();return scan.fields.map(f=>({id:f.idAttr,label:f.label,group:f.group,record:f.recordIndex}));
  });
  for(let i=0;i<2;i++){
   assert.deepEqual(before.find(f=>f.id==='degree-'+i),{id:'degree-'+i,label:'学历',group:'教育经历',record:i+1},'deep dropdown and ordinary school must belong to the same record');
   assert.deepEqual(before.find(f=>f.id==='school-'+i),{id:'school-'+i,label:'学校名称',group:'教育经历',record:i+1});
   assert.equal(before.find(f=>f.id==='role-'+(i+1)).group,'校园经历');
   assert.equal(before.find(f=>f.id==='duties-'+(i+1)).record,i+1);
  }
  assert.equal(before.find(f=>f.id==='after-control').group,'语言能力','input values, navigation and field labels cannot become section headings');
  assert.equal(before.find(f=>f.id==='deep-unknown').label,'请输入','deep unlabeled input retains only its own placeholder, never a neighbor caption');
  const formFields=await page.evaluate(()=>scan.fields),resume=[
   {fieldId:'school-source-0',group:'教育经历',recordId:'master',key:'硕士学校',value:'示例大学'},
   {fieldId:'school-source-1',group:'教育经历',recordId:'bachelor',key:'学士学校',value:'示例大学'},
   {fieldId:'level-source-0',group:'基本信息',recordId:'basic',key:'学历',value:'硕士'},
   {fieldId:'level-source-1',group:'教育经历',recordId:'bachelor',key:'学历',value:'本科'},
   {fieldId:'language-source',group:'语言能力',recordId:'english',key:'英语水平',value:'英语：良好，六级520'}
  ];
  const values={'school-0':['示例大学','school-source-0'],'school-1':['示例大学','school-source-1'],
   'degree-0':['硕士研究生','level-source-0'],'degree-1':['大学本科','level-source-1'],'language':['英语','language-source']};
  const ctx={importScripts(){},ResumeProAIHelpers:require('../ai-helpers'),AbortController,TextEncoder,performance,setTimeout,clearTimeout,
   fetch:async()=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(formFields.filter(f=>values[f.idAttr]).map(f=>({fieldId:f.fieldId,value:values[f.idAttr][0],sourceId:values[f.idAttr][1]})))}}]})})};
  ctx.self=ctx;vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(root,'ai-worker.js'),'utf8'),ctx);
  const matched=await ctx.handleAiFill({formFields,resumeFields:resume,aiConfig:{apiUrl:'https://fixture.invalid/api',model:'fixture',apiKey:'fixture'}});
  assert.equal(matched.diagnostics.rejectedSources,0,JSON.stringify(matched));assert.equal(matched.diagnostics.recordFactMatches,1);
  const fill=async(id,value)=>page.evaluate(async({id,value})=>{
   const api=ResumeProHighlightTest,f=scan.fields.find(f=>f.idAttr===id),entry=scan.fieldMap.get(f.fieldId);
   entry.decide=async s=>({id:(s.candidates.find(c=>c.kind==='choose'&&c.label===s.levelTarget)||s.candidates.find(c=>c.kind==='open')||s.candidates.find(c=>c.kind==='stop')).id});
   const ok=await api.setElementValue(entry,value);return {ok,value:api.readBackValue(entry),note:entry.fillNote,trace:entry.interactions};
  },{id,value});
  for(const id of ['degree-0','degree-1','language','proficiency']){
   const field=formFields.find(f=>f.idAttr===id),match=matched.matches.find(m=>m.fieldId===field.fieldId);assert.ok(match,id+JSON.stringify(matched));
   const value=match.value;
   const result=await fill(id,value);assert.equal(result.ok,true,id+JSON.stringify(result));assert.equal(result.value,value);
   assert.equal(await page.locator('.phoenix-selectList:visible').count(),0,'own menu must be dismissed before the next field');
   console.log('PASS actual Phoenix components:',id,value);
  }
  const countBefore=await page.evaluate(()=>actions.length);
  assert.equal((await fill('protected','英语')).ok,false);assert.equal(await page.evaluate(()=>actions.length),countBefore);
  for(const id of ['disabled','duplicate']){const result=await fill(id,'英语');assert.equal(result.ok,false,id+JSON.stringify(result));assert.equal(result.value,'');}
  const state=await page.evaluate(()=>({values,untrusted:actions.filter(a=>!a.trusted).length,fields:ResumeProHighlightTest.scanFillableFields().fields.length,
    collected:ResumeProHighlightTest.readFilledFields().filter(f=>f.label==='学历').map(f=>[f.group,f.recordIndex,f.value])}));
  assert.deepEqual(state.values,{'degree-0':'硕士研究生','degree-1':'大学本科',language:'英语',proficiency:'良好'});
  assert.equal(state.untrusted,0);assert.equal(state.fields,before.length,'popup controls never enter the resume scanner');assert.deepEqual(errors,[]);
  assert.deepEqual(state.collected,[['教育经历',1,'硕士研究生'],['教育经历',2,'大学本科']],'collection keeps combobox section and record ownership');
  console.log('PASS actual Phoenix disabled parent flags, duplicate choices, protected value, deep records, styled headings, menu cleanup and trusted input');
 }finally{await browser.close();fs.rmSync(output,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
