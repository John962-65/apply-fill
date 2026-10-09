// Actual scanner, source validator and fill button; anonymous model/storage fixture.
// Assert the final DOM, not just the worker's returned matches.
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),H=require('../ai-helpers');
const fact=(id,recordId,label,value)=>({id,recordId,label,key:recordId+'-'+label,value});
const group=(id,name,records,fields)=>({id:'g-'+id,name,records:records.map(id=>({id,name:id})),fields});
const periods=[['2024-09','2027-06'],['2020-09','2024-06']];
const projectPeriods=[['2025-03','2025-07'],['2026-03','2026-08'],['2026-01','2026-09'],['2026-08','2026-09'],['2026-01','2026-09'],['2026-01','2026-09'],['2026-01','2026-09']];
const awardDates=['2022-12','2024-09','2025-05','2025-09','2026-09'];
const existingOrder=[5,1,2,3,4,6,7];
const fixtureStore={templates:[{id:'t',name:'Anonymous split dates',groups:[
 group('personal','个人信息',['person'],[fact('gender','person','性别','男'),fact('address','person','现居住地','示例市示例区'),fact('birth','person','出生日期','2002-03-15')]),
 group('education','教育经历',['e1','e2'],periods.flatMap(([start,end],i)=>{const n=i+1,r='e'+n;return [fact('school-'+n,r,'学校名称','示例大学'),fact('major-'+n,r,'专业',n===1?'机械工程':'控制工程'),fact('edu-level-'+n,r,'学历',n===1?'硕士':'学士'),fact('edu-start-'+n,r,'开始时间',start),fact('edu-end-'+n,r,'结束时间',end)];})),
 group('project','项目经历',projectPeriods.map((_,i)=>'p'+(i+1)),projectPeriods.flatMap(([start,end],i)=>{const n=i+1,r='p'+n;return [fact('p-name-'+n,r,'项目名称','匿名项目'+n),fact('p-role-'+n,r,'项目角色',n<=2?'成员':'负责人'),fact('p-overview-'+n,r,'内容概述','项目'+n+'建立并验证独立算法流程，完成研究目标。'),fact('p-duties-'+n,r,'主要工作','项目'+n+'负责数据整理、系统实现及实验结果评审。'),fact('p-start-'+n,r,'开始时间',start),fact('p-end-'+n,r,'结束时间',end)];})),
 group('language','语言能力',['english'],[fact('language','english','语言','英语'),fact('proficiency','english','掌握程度','熟练'),fact('listening','english','听说能力','良好'),fact('reading','english','读写能力','良好')]),
 group('summary','自我评价',[],[fact('summary','','自我评价','擅长逻辑推理，参与团队活动并持续学习。')]),
 group('award','获奖经历',awardDates.map((_,i)=>'a'+(i+1)),awardDates.flatMap((date,i)=>{const n=i+1,r='a'+n;return [fact('award-name-'+n,r,'获奖名称',n===1?'匿名校级奖学金':n===3?'匿名科技竞赛优胜奖':'匿名研究生学业奖学金'),fact('award-date-'+n,r,'获奖时间',date)];}))
]}],activeTemplateId:'t',aiConfig:{apiUrl:'https://fixture.invalid/api',model:'fixture',apiKey:'fixture'}};
function modelMatches(message,mode){
 const direct={gender:['男','gender'],highest:['硕士','edu-level-1'],address:['示例市示例区','address'],birth:['2002-03-15','birth'],summary:['擅长逻辑推理，参与团队活动并持续学习。','summary'],language:['英语','language'],proficiency:['熟练','proficiency'],listening:['良好','listening'],reading:['良好','reading']};
 const original=new Map(message.resumeFields.map(f=>[f.fieldId,f]));
 return message.formFields.flatMap(f=>{
  let data=direct[f.idAttr],id=f.idAttr||'';
  let match=id.match(/^(school|major)-(\d+)$/);if(match)data=[original.get(id).value,id];
  match=id.match(/^education-(\d+)-level$/);if(match)data=[match[1]==='1'?'硕士':'本科','edu-level-'+match[1]];
  match=id.match(/^project-(\d+)-(name|role|overview|duties)$/);if(match){const source='p-'+match[2]+'-'+match[1];data=[original.get(source).value,source];}
  match=id.match(/^award-(\d+)-name$/);if(match)data=[original.get('award-name-'+match[1]).value,'award-name-'+match[1]];
  if(f.datePart&&mode!=='fallback'&&mode!=='sd-caption'){
   match=id.match(/^(education|project)-(\d+)-([ab])-(year|month)$/);
   if(match){const source=(match[1]==='education'?'edu-':'p-')+(match[3]==='a'?'start':'end')+'-'+match[2];data=[H.datePartValue(original.get(source).value,match[4]),source];}
   match=id.match(/^award-(\d+)-(year|month)$/);if(match){const source='award-date-'+match[1];data=[H.datePartValue(original.get(source).value,match[2]),source];}
  }
  // Repeated months must be resolved by independent record context, not row order.
  return data?[{fieldId:f.fieldId,value:data[0],...(f.datePart?{}:{sourceId:data[1]})}]:[];
 });
}
(async()=>{
 const {performInput}=await import('../browser-input.mjs');
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH,args:['--no-sandbox']});
 try{
  for(const mode of process.env.SPLIT_RESUME_MODES?.split(',')||['normal','fallback','rerender','sd-caption','sd-input','sd-rerender','sd-sibling-existing']){
   const page=await browser.newPage({viewport:{width:1100,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
   const cdp=await page.context().newCDPSession(page);await page.exposeFunction('realInput',action=>performInput((m,p)=>cdp.send(m,p),action).catch(error=>({ok:false,error:error.message,errorCode:error.code})));
   await page.route('https://fixture.invalid/**',route=>route.fulfill({contentType:'text/html',body:fs.readFileSync(path.join(__dirname,'fixtures/split-resume.html'),'utf8')}));
   await page.exposeFunction('workerFill',async message=>{
    const w={importScripts(){},ResumeProAIHelpers:H,AbortController,TextEncoder,performance,setTimeout,clearTimeout,
     fetch:async()=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(modelMatches(message,mode))}}]})})};
    w.self=w;vm.createContext(w);vm.runInContext(fs.readFileSync(path.join(root,'ai-worker.js'),'utf8'),w);
    const result=await w.handleAiFill(message);
    assert.equal(result.matches.length,94,JSON.stringify({count:result.matches.length,diagnostics:result.diagnostics}));
    if(mode==='sd-sibling-existing')assert.ok(result.diagnostics.sourceRejections.length>0,'deliberately wrong AI record must be rejected');
    else assert.equal(result.diagnostics.sourceRejections.length,0,JSON.stringify(result.diagnostics));
    if(mode==='fallback'||mode==='sd-caption')assert.equal(result.diagnostics.ruleMatches,46);
    return JSON.parse(JSON.stringify(result));
   });
   await page.goto('https://fixture.invalid/form?mode='+mode);
   await page.evaluate(({store,mode})=>{
    self.rerender=mode==='rerender';self.__RESUME_PRO_TEST__=true;self.fixtureStore=store;
    const host=document.createElement('div');host.id='resume-pro-sidebar';document.body.append(host);
    self.chrome={runtime:{id:'fixture',getManifest:()=>({version:'test'}),getURL:p=>new URL(p,location.origin).href,sendMessage:async m=>{
     if(m.type==='AI_FILL')return workerFill(m);
     if(m.type==='BROWSER_INPUT')return realInput(m.action);
     if(m.type==='AI_INTERACTION_STEP')return {success:true,action:{id:(m.observation.candidates.find(c=>c.kind==='write')||m.observation.candidates.find(c=>c.kind==='stop')).id}};
     return {ready:true};
    }},storage:{local:{get:async()=>structuredClone(fixtureStore),set:async changes=>Object.assign(fixtureStore,changes)},onChanged:{addListener(){}}}};
    if(mode==='sd-sibling-existing'){
     const order=[5,1,2,3,4,6,7];
     order.forEach((record,n)=>{document.getElementById('project-'+(n+1)+'-name').value='匿名项目'+record;});
    }
   },{store:structuredClone(fixtureStore),mode});
   for(const script of JSON.parse(fs.readFileSync(path.join(root,'manifest.json'))).content_scripts[0].js)await page.addScriptTag({path:path.join(root,script)});
   const result=await page.evaluate(async()=>{
    const api=ResumeProHighlightTest,shadow=document.getElementById('resume-pro-sidebar').attachShadow({mode:'open'});
    shadow.innerHTML='<button id="resume-pro-ai-fill">填写</button><input id="resume-pro-browser-input" type="checkbox" checked><div id="resume-pro-status"></div><details id="resume-pro-trace"><textarea id="resume-pro-trace-text"></textarea></details>';
    fixtureStore.templates=fixtureStore.templates.map(ResumeProTree.normalizeTemplate);const before=structuredClone(fixtureStore.templates);
    api.setCurrentStore(fixtureStore);api.setShadowRoot(shadow);const scan=api.scanFillableFields();
    const fields=scan.fields;
    await api.handleAiFillClick({currentTarget:shadow.querySelector('button')});
    return {fields,status:shadow.querySelector('#resume-pro-status').textContent,trace:shadow.querySelector('textarea').value,
     values:{...Object.fromEntries(Array.from(document.querySelectorAll('main input,main textarea,main select'),e=>[e.id,e.tagName==='SELECT'?e.selectedOptions[0].textContent:e.value])),...self.sdChosen},
     collected:api.readFilledFields(),before,after:fixtureStore.templates,replacements,sdStats:self.sdStats,open:document.querySelectorAll('.sd-choice-list,.floating-a91').length};
   });
   assert.equal(result.fields.length,108);
   for(const [prefix,total,group] of [['education',2,'教育背景'],['project',7,'项目经历'],['award',5,'获奖经历']])for(let n=1;n<=total;n++){
    const fields=result.fields.filter(f=>f.idAttr.startsWith(prefix+'-'+n+'-')||prefix==='education'&&['school-'+n,'major-'+n].includes(f.idAttr));
    assert.ok(fields.length);assert.ok(fields.every(f=>f.recordIndex===n&&f.group===group),JSON.stringify(fields));
    assert.equal(new Set(fields.map(f=>f.recordSignature)).size,1);
   }
   assert.equal(result.fields.find(f=>f.idAttr==='summary').group,'自我评价');
   assert.equal(result.fields.find(f=>f.idAttr==='highest').group,'个人信息');
   assert.equal(result.open,0,JSON.stringify({status:result.status,stats:result.sdStats,trace:result.trace}));if(mode.startsWith('sd-')){assert.equal(result.sdStats.untrusted,0);assert.equal(result.sdStats.selected,58,JSON.stringify({status:result.status,trace:result.trace}));}
   assert.match(result.status,new RegExp('已填写 '+(mode==='sd-sibling-existing'?87:94)+' 个字段'),JSON.stringify({status:result.status,trace:result.trace}));
   assert.doesNotMatch(result.status,/没填上|被来源|被页面顶掉/);assert.doesNotMatch(result.trace,/来源校验拦截|读回为空|日期区间不完整/);
   for(const [prefix,dates] of [['education',periods],['project',mode==='sd-sibling-existing'?existingOrder.map(n=>projectPeriods[n-1]):projectPeriods]])dates.forEach(([start,end],i)=>{
    for(const [edge,date] of [['a',start],['b',end]]){
     const [year,month]=date.split('-');assert.equal(result.values[`${prefix}-${i+1}-${edge}-year`],year+'年');assert.equal(result.values[`${prefix}-${i+1}-${edge}-month`],Number(month)+'月');
    }
   });
   awardDates.forEach((date,i)=>{const [year,month]=date.split('-');assert.equal(result.values[`award-${i+1}-year`],year+'年');assert.equal(result.values[`award-${i+1}-month`],Number(month)+'月');});
   assert.equal(result.values['education-2-level'],'本科');assert.equal(result.values.summary,fixtureStore.templates[0].groups[4].fields[0].value);
   if(mode==='sd-sibling-existing')existingOrder.forEach((record,i)=>{
    assert.equal(result.values[`project-${i+1}-name`],'匿名项目'+record);
    assert.ok(result.values[`project-${i+1}-overview`].startsWith('项目'+record),JSON.stringify(result.values));
   });
   const collectedDates=result.collected.filter(f=>/时间/.test(f.label));assert.equal(collectedDates.length,23);assert.ok(collectedDates.every(f=>/^\d{4}-\d{2}$/.test(f.value)),JSON.stringify(collectedDates));
   assert.deepEqual(result.before,result.after);assert.deepEqual(errors,[]);if(mode==='rerender')assert.ok(result.replacements>=80);
   if(mode==='normal'){
    const negative=await page.evaluate(async()=>{
     const api=ResumeProHighlightTest,scan=api.scanFillableFields(),parts=scan.fields.filter(f=>/^education-1-[ab]-/.test(f.idAttr));
     const matches=parts.map(meta=>({fieldId:meta.fieldId,value:meta.rangeRole==='start'?(meta.datePart==='year'?'2027':'09'):(meta.datePart==='year'?'2024':'06'),resumeRecordId:'e1',resumeGroupId:'g-education'}));
     const reversed=api.rangeMatchReason(parts,matches);
     const crossRecord=api.rangeMatchReason(parts,matches.map((match,index)=>({...match,resumeRecordId:index===3?'e2':'e1'})));
     const incomplete=api.rangeMatchReason(parts,matches.slice(0,3));
     const written=new Map();for(const meta of parts){const entry=scan.fieldMap.get(meta.fieldId);entry.meta=meta;const value=matches.find(m=>m.fieldId===meta.fieldId).value;await api.setElementValue(entry,value);written.set(meta.fieldId,{meta,entry,value});}
     const outcomes=new Map(),verification=await api.verifyWrittenValues(written,outcomes);
     document.querySelector('[data-record="education-1"] .period > span').remove();
     const ambiguous=api.scanFillableFields().fields.filter(f=>/^education-1-[ab]-/.test(f.idAttr));
     return {reversed,crossRecord,incomplete,drift:verification.drift,reasons:[...outcomes.values()].map(o=>o.failureReason),ambiguous:ambiguous.map(f=>({unresolved:f.dateRangeUnresolved,recordIndex:f.recordIndex,rangeId:f.rangeId}))};
    });
    assert.match(negative.reversed,/来源日期顺序异常/);assert.match(negative.crossRecord,/同一条简历记录/);assert.match(negative.incomplete,/成对来源/);
    assert.equal(negative.drift,4);assert.ok(negative.reasons.every(reason=>reason==='日期区间不完整或顺序异常'));
    assert.equal(negative.ambiguous.length,4);assert.ok(negative.ambiguous.every(f=>f.unresolved&&f.recordIndex===1&&!f.rangeId),JSON.stringify(negative));
   }
   console.log('PASS 108-field split resume: 94 grounded values and 23 complete collected dates:',mode);await page.close();
  }
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
