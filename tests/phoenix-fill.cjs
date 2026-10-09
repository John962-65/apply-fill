// Full fill button path. Model replies and extension storage are fixtures; scanner, worker
// source validation, controller, CDP input and final page readback are production code.
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:1100,height:850}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const {performInput}=await import('../browser-input.mjs'),cdp=await page.context().newCDPSession(page);
  await page.exposeFunction('realInput',a=>performInput((m,p)=>cdp.send(m,p),a));
  await page.exposeFunction('workerFill',async message=>{
   const language=message.formFields.find(f=>f.idAttr==='language');
   assert.deepEqual(language.options,['英语'],'stale cached options and placeholders must not replace live choices');
   assert.equal(language.optionsSource,'live');
   const values={language:['英语','lang'],existing:['硕士','degree'],award:['2021-12','award-date'],birthday:['2000-05','birth-source'],
    'project-one':['示例项目甲','name1'],'project-two':['示例项目乙','name2'],
    'start-one':['2022-02','start1'],'end-one':['2024-06','end1'],'start-two':['2020-01','start2'],'end-two':['2021-12','end2'],
    'desc-one':['设计调度模块并完成验证。研究并实现路径规划系统。',['body1','work1']],
    'desc-two':['模型改写了无法验证的内容。','missing'],
    'campus-role-1':['干事','campus-role-source-1'],'campus-duties-1':['负责社团活动策划。','campus-description-source-1'],
    'campus-role-2':['干事','legacy-campus-2'],'campus-duties-2':['组织比赛，担任裁判。','campus-description-source-2'],
    'campus-start-1':['2020-09','campus-start-source-1'],'campus-end-1':['2022-06','campus-end-source-1'],
    'campus-start-2':['2020-09','campus-start-source-2'],'campus-end-2':['2022-06','campus-end-source-2'],
    'proficiency':['良好','lang']};
   const campus=message.formFields.filter(f=>f.idAttr.startsWith('campus-'));
   assert.deepEqual(campus.map(f=>[f.group,f.recordIndex]),[...Array(4).fill(['校园经历',1]),...Array(4).fill(['校园经历',2])]);
   for(let i=1;i<=3;i++){
    const date=message.resumeFields.find(f=>f.fieldId==='legacy-award'+i);
    const name=message.resumeFields.find(f=>f.synthetic&&f.recordId===date.recordId&&f.label==='获奖名称');
    assert.equal(name.value,'示例学业奖学金一等奖');
    values['award-name-'+i]=[name.value,name.fieldId];values['award-date-'+i]=[date.value,date.fieldId];
   }
   // Even a real date source must not be accepted for a checkbox.
   values['ongoing-1']=['2024-06','end1'];values['ongoing-2']=['2021-12','end2'];
   const proposed=message.formFields.filter(f=>values[f.idAttr]).map(f=>{const [value,id]=values[f.idAttr];return {fieldId:f.fieldId,value,...(Array.isArray(id)?{sourceIds:id}:{sourceId:id})};});
   const ctx={importScripts(){},ResumeProAIHelpers:require('../ai-helpers'),AbortController,TextEncoder,setTimeout,clearTimeout,performance,
    fetch:async()=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(proposed)}}]})})};ctx.self=ctx;vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(root,'ai-worker.js'),'utf8'),ctx);
   const result=await ctx.handleAiFill(message);assert.equal(result.matches.length,28,JSON.stringify(result));
   assert.equal(result.diagnostics.recordFallbackMatches,1,'rejected project rewrite uses its own original narrative');
   assert.equal(result.diagnostics.recordFactMatches,2,'verified campus narrative recovers the legacy role; explicit natural-language listening level is independent of overall proficiency');return result;
  });
  await page.route('https://fixture.invalid/**',r=>{
   const name=new URL(r.request().url()).pathname.slice(1),file=path.resolve(root,name||'missing');
   const asset=file.startsWith(root+path.sep)&&fs.existsSync(file)&&fs.statSync(file).isFile();
   return r.fulfill({contentType:asset&&(name.endsWith('.js')||name.endsWith('.mjs'))?'text/javascript':asset&&name.endsWith('.css')?'text/css':'text/html',body:fs.readFileSync(asset?file:path.join(__dirname,'fixtures/phoenix-controls.html'),'utf8')});
  });
  await page.goto('https://fixture.invalid/form');
  await page.evaluate(()=>{
   self.mode='normal';self.__RESUME_PRO_TEST__=true;
   document.body.classList.add('beisen-fixture');
   document.getElementById('existing').closest('section').insertAdjacentHTML('beforeend','<div class="form-item--phoenix"><label>手机号码<input id="mobile" type="tel"></label></div>');
   document.getElementById('existing').closest('section').insertAdjacentHTML('beforeend','<div class="form-item--phoenix"><label>出生日期<input id="birthday" type="date"></label></div>');
   document.getElementById('language').closest('section').insertAdjacentHTML('beforeend',
    '<div class="form-item--phoenix"><label>掌握程度<select id="proficiency"><option value="">请选择</option><option>良好</option></select></label></div>'+
    '<div class="form-item--phoenix"><label>听说<select id="listening"><option value="">请选择</option><option>良好</option></select></label></div>'+
    '<div class="form-item--phoenix"><label>读写<select id="reading-writing"><option value="">请选择</option><option>良好</option></select></label></div>');
   const campus=document.createElement('section');
   campus.innerHTML='<div class="sc-anonymous"><span>在校职务</span></div>'+[1,2].map(i=>`<article><div class="form-item--phoenix"><label>职务名称<input id="campus-role-${i}"></label></div><div class="form-item--phoenix"><label>职务描述<textarea id="campus-duties-${i}"></textarea></label></div><div class="form-item--phoenix"><div class="field-label">开始时间</div><div class="phoenix-select" id="campus-start-${i}"></div></div><div class="form-item--phoenix"><div class="field-label">结束时间</div><div class="phoenix-select" id="campus-end-${i}"></div></div></article>`).join('');
   campus.querySelectorAll('.phoenix-select').forEach(r=>renderControl(r));
   document.querySelector('main').append(campus);
   document.querySelectorAll('.record').forEach((r,i)=>{const row=document.createElement('div');row.className='form-item--phoenix';row.innerHTML=`<label>项目描述<textarea id="desc-${i?'two':'one'}"></textarea></label>`;r.append(row);});
   const awards=document.getElementById('award').closest('section');
   for(let i=1;i<=3;i++){
    const row=document.createElement('article');row.className='award-record';
    row.innerHTML=`<div class="form-item--phoenix"><label>获奖项<input id="award-name-${i}"></label></div><div class="form-item--phoenix"><div class="field-label">获奖时间</div><div class="phoenix-select" id="award-date-${i}"></div></div>`;
    awards.append(row);renderControl(row.querySelector('.phoenix-select'));
   }
   document.querySelectorAll('.record').forEach((r,i)=>{
    r.querySelectorAll('.form-item--phoenix')[2].insertAdjacentHTML('beforeend',`<div class="phoenix-checkbox"><span class="phoenix-checkbox__box"><input type="checkbox" id="ongoing-${i+1}" class="phoenix-checkbox__input"></span><span>至今</span></div>`);
   });
   document.querySelectorAll('.phoenix-select').forEach(r=>{
    const layer=document.createElement('div');layer.className='phoenix-unmodeled-layer__content';layer.style.cssText='position:static;padding:0;border:0;background:none';r.before(layer);layer.append(r);
   });
   const projects=[1,2].flatMap(i=>[
    {id:'name'+i,recordId:'r'+i,key:`项目${i}-项目名称`,label:'项目名称',value:i===1?'示例项目甲':'示例项目乙'},
    {id:'start'+i,recordId:'r'+i,key:`项目${i}-开始时间`,label:'开始时间',value:i===1?'2022-02':'2020-01'},
    {id:'end'+i,recordId:'r'+i,key:`项目${i}-结束时间`,label:'结束时间',value:i===1?'2024-06':'2021-12'},
    {id:'body'+i,recordId:'r'+i,key:`项目${i}-内容概述`,label:'内容概述',value:i===1?'研究并实现路径规划系统。':'研究并实现数据分析系统。'},
    {id:'work'+i,recordId:'r'+i,key:`项目${i}-主要工作`,label:'主要工作',value:i===1?'设计调度模块并完成验证。':'开发测试工具并完成验证。'}]);
   const store={templates:[{id:'t',name:'匿名资料',groups:[
    {id:'project-group',name:'项目经历',records:[{id:'r1',name:'示例项目甲'},{id:'r2',name:'示例项目乙'}],fields:projects},
    {id:'language-group',name:'技能',fields:[{id:'lang',key:'英语水平',value:'英语六级，具有良好的英语听说以及阅读能力'}]},
    {id:'award-group',name:'获奖经历',fields:[{id:'award-date',key:'获奖时间',value:'2021-12'},...[1,2,3].map(i=>({id:'legacy-award'+i,key:'示例学业奖学金一等奖-获奖时间'+(i>1?' ('+i+')':''),value:(2023+i)+'-09'}))]},
    {id:'basic',name:'基本信息',fields:[{id:'degree',key:'最高学历',value:'硕士'},{id:'telephone',key:'电话',value:'13800000000（微信同号）'},{id:'birth-source',key:'生日',value:'2000年5月17日'}]},
    {id:'campus-group',name:'校园经历',records:[{id:'c1',name:'社团联合会'},{id:'c2',name:'球类协会'},{id:'legacy-campus',name:'待归类资料'}],fields:[
     {id:'campus-role-source-1',recordId:'c1',key:'社团联合会-职位',label:'职位',value:'干事'},
     {id:'campus-description-source-1',recordId:'c1',key:'社团联合会-描述',label:'描述',value:'负责社团活动策划。'},
     {id:'campus-start-source-1',recordId:'c1',key:'社团联合会-开始时间',label:'开始时间',value:'2020-09'},
     {id:'campus-end-source-1',recordId:'c1',key:'社团联合会-结束时间',label:'结束时间',value:'2022-06'},
     {id:'campus-organization-source-2',recordId:'c2',key:'球类协会-活动名称',label:'活动名称',value:'球类协会'},
     {id:'campus-description-source-2',recordId:'c2',key:'球类协会-描述',label:'描述',value:'组织比赛，担任裁判。'},
     {id:'campus-start-source-2',recordId:'c2',key:'球类协会-开始时间',label:'开始时间',value:'2020-09'},
     {id:'campus-end-source-2',recordId:'c2',key:'球类协会-结束时间',label:'结束时间',value:'2022-06'},
     {id:'legacy-campus-2',recordId:'legacy-campus',key:'校园2',label:'校园2',value:'球类协会干事，组织比赛，担任裁判。'}]}
   ]}],activeTemplateId:'t',aiConfig:{apiUrl:'https://fixture.invalid/api',model:'fixture',apiKey:'fixture'}};
   store.formStructures=[{version:2,mappingSchema:3,platform:'beisen',fields:[{group:'语言能力',label:'语言',control:'combobox',drive:'open-pick',options:['法语']}]}];
   self.fixtureStore=store;const h=document.createElement('div');h.id='resume-pro-sidebar';document.body.append(h);
   self.chrome={runtime:{id:'fixture',getManifest:()=>({version:'test'}),getURL:p=>new URL(p,location.origin).href,sendMessage:async m=>{
    if(m.type==='BROWSER_INPUT')return realInput(m.action);if(m.type==='AI_FILL')return workerFill(m);
    if(m.type==='AI_INTERACTION_STEP'){const s=m.observation;return {success:true,action:{id:(s.candidates.find(c=>c.kind==='choose'&&c.label===s.levelTarget)||s.candidates.find(c=>c.kind==='open')||s.candidates.find(c=>c.kind==='search')||s.candidates.find(c=>c.kind==='stop')).id}};}
    return {ready:true};
   }},storage:{local:{get:async()=>structuredClone(store),set:async value=>Object.assign(store,value)},onChanged:{addListener(){}}}};
  });
  for(const script of JSON.parse(fs.readFileSync(path.join(root,'manifest.json'))).content_scripts[0].js)await page.addScriptTag({path:path.join(root,script)});
  const result=await page.evaluate(async()=>{
   const api=ResumeProHighlightTest,h=document.getElementById('resume-pro-sidebar').attachShadow({mode:'open'});h.innerHTML='<button id="resume-pro-ai-fill">填写</button><div id="resume-pro-status"></div><input type="checkbox" id="resume-pro-browser-input" checked>';
   fixtureStore.templates=fixtureStore.templates.map(ResumeProTree.normalizeTemplate);
   api.setShadowRoot(h);api.setCurrentStore(fixtureStore);await api.handleAiFillClick({currentTarget:h.querySelector('button')});
   return {status:h.querySelector('#resume-pro-status').textContent,values,
    facts:{phone:document.getElementById('mobile').value,birthday:document.getElementById('birthday').value,listening:document.getElementById('listening').value,proficiency:document.getElementById('proficiency').value,readingWriting:document.getElementById('reading-writing').value,roles:[...document.querySelectorAll('input[id^="campus-role-"]')].map(n=>n.value)},
    descriptions:[...document.querySelectorAll('textarea')].map(n=>n.value),names:[...document.querySelectorAll('.record input:not(.phoenix-select__input):not([type="checkbox"])')].map(n=>n.value),
    awardNames:[...document.querySelectorAll('.award-record input:not(.phoenix-select__input)')].map(n=>n.value),flags:[...document.querySelectorAll('input[type="checkbox"]')].map(n=>n.checked),
    degree:document.getElementById('existing').querySelector('.phoenix-select__tipEle').textContent,wrong:unrelatedClicks,untrusted:actions.filter(a=>!a.trusted).length};
  });
  assert.match(result.status,/已填写 27 个字段/,JSON.stringify(result));assert.doesNotMatch(result.status,/没填上|未通过|被页面顶掉|填写失败/);
  assert.match(result.status,/1 项被来源校验拦截/);assert.deepEqual(result.facts,{phone:'13800000000',birthday:'2000-05-17',listening:'良好',proficiency:'',readingWriting:'',roles:['干事','干事']});
  assert.deepEqual(result.values,{language:'英语','start-one':'2022-02','end-one':'2024-06','start-two':'2020-01','end-two':'2021-12',award:'2021-12','award-date-1':'2024-09','award-date-2':'2025-09','award-date-3':'2026-09','campus-start-1':'2020-09','campus-end-1':'2022-06','campus-start-2':'2020-09','campus-end-2':'2022-06'});
  assert.deepEqual(result.descriptions,['设计调度模块并完成验证。研究并实现路径规划系统。','研究并实现数据分析系统。\n开发测试工具并完成验证。','负责社团活动策划。','组织比赛，担任裁判。']);
  assert.deepEqual(result.names,['示例项目甲','示例项目乙']);assert.equal(result.degree,'硕士');assert.equal(result.wrong,0);assert.equal(result.untrusted,0);assert.deepEqual(errors,[]);
  assert.deepEqual(result.awardNames,Array(3).fill('示例学业奖学金一等奖'));assert.deepEqual(result.flags,[false,false]);
  console.log('PASS Phoenix full fill: four campus dates with same-valued roles bound by own narratives, legacy roles and source poisoning, annotated phone, literal listening without overall/read-write inference, accurate source-block status, own-record narrative, four project date endpoints, repeated awards, untouched checkboxes, protected existing value, final DOM readback');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
