/* Real DOM/UI regression suite. Browser extension storage/messaging and model replies are
 * fixtures; the manager, model, serialized store, importer and exporter are production code.
 * npm install && npx playwright install chromium && npm run test:ui
 */
const {chromium}=require('playwright');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const mime={'.js':'text/javascript','.mjs':'text/javascript','.html':'text/html','.css':'text/css','.woff2':'font/woff2','.svg':'image/svg+xml'};
const server=http.createServer((req,res)=>{
 const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
 if(pathname==='/__parse_fixture') {
   const extraction={schemaVersion:1,sections:[{id:'basic',records:[{name:'本人',fields:[{label:'姓名',value:'匿名进程示例',evidence:'姓名：匿名进程示例'}]}]}],unclassified:[]};
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(extraction)}}]}));return;
 }
 const base=pathname.startsWith('/__fonts/')&&process.env.TEST_FONT_DIR?process.env.TEST_FONT_DIR:root;
 const file=path.resolve(base,pathname.startsWith('/__fonts/')?pathname.slice(9):'.'+pathname);
 if(!file.startsWith(base+path.sep)){res.writeHead(403);res.end();return;}
 fs.readFile(file,(error,data)=>{if(error){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.end(data);});
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try {
 const context=await browser.newContext({viewport:{width:1440,height:1120}});
 await context.route('https://api.github.com/**',r=>r.fulfill({status:404,body:'{}'}));
 await context.addInitScript(()=>{
   self.__RESUME_PRO_TEST__=true;
   let data=JSON.parse(localStorage.getItem('fixture-store')||'null')||{
     templates:[{id:'sample',name:'机器人算法岗位',groups:[
       {name:'基本信息',fields:[{key:'姓名',value:'张三'},{key:'手机号',value:'13800000000'},{key:'邮箱',value:'demo@example.com'}]},
       {name:'教育经历',fields:[{key:'教育1学校',value:'示例大学'},{key:'教育1学历',value:'硕士'},{key:'教育1专业',value:'机械电子工程'},{key:'教育1入学时间',value:'2024-09'},{key:'教育2学校',value:'示例大学'},{key:'教育2学历',value:'本科'},{key:'教育2专业',value:'机械工程'}]},
       {name:'项目经历',fields:[{key:'多机械臂规划项目-项目名称',value:'多机械臂运动规划与协调'},{key:'多机械臂规划项目-主要工作',value:'面向多台机械臂共享工作空间的并发操作任务，开发运动规划与在线协调系统。结合路径搜索与时间协调，完成仿真场景验证。'},{key:'多机械臂规划项目-开始时间',value:'2025-03'}]},
       {name:'语言与证书',fields:[{key:'英语六级',value:'510'}]}
     ]}],activeTemplateId:'sample',aiConfig:{apiUrl:'https://model.invalid/v1/chat/completions',model:'fixture',apiKey:'fixture-key'},profile:{values:{},family:[],custom:[]}
   };
   const listeners=[];let messageHandler,storeReady;
   const local={get:async keys=>keys===null?structuredClone(data):Object.fromEntries((typeof keys==='string'?[keys]:keys).filter(k=>k in data).map(k=>[k,structuredClone(data[k])])),set:async changes=>{
     const events=Object.fromEntries(Object.entries(changes).map(([k,v])=>[k,{oldValue:data[k],newValue:v}]));
     Object.assign(data,structuredClone(changes));localStorage.setItem('fixture-store',JSON.stringify(data));
     queueMicrotask(()=>listeners.forEach(fn=>fn(events,'local')));
   }};
   self.chrome={storage:{local,onChanged:{addListener:fn=>listeners.push(fn)}},runtime:{id:'fixture',getURL:p=>new URL(p,location.origin).href,getManifest:()=>({version:'0.6.0'}),onMessage:{addListener:fn=>messageHandler=fn},sendMessage:async m=>{
     if(m.type==='ENSURE_AI_HOST'||m.type==='AI_HOST_READY')return {ready:true};
     if(m.type==='CANCEL_AI_FILL')return {cancelled:true};
     if(m.type==='AI_ORGANIZE_COLLECTION') {
       if(self.fixtureAiWait)return new Promise(resolve=>self.fixtureFinishAi=resolve);
       if(self.fixtureAiFailure)return {success:false,error:'模拟接口离线，原始内容已保留。'};
       return {success:true,suggestions:m.context.pending.map(p=>{
         if(p.group==='新增项目')return {id:p.id,action:'add',groupName:'项目经历',recordName:'新项目B',label:p.key,summary:p.value.length>100?'实现规划与仿真验证。':'',reason:'网页项目名称与现有经历不同'};
         const record=m.context.records.find(r=>r.groupName===p.group);
         const field=record?.fields.find(f=>f.label===p.key);
         return {id:p.id,action:field?'update':'add',recordId:record?.recordId||'',fieldId:field?.fieldId||'',label:p.key,groupName:record?.groupName||p.group,recordName:record?.recordName||'',reason:'根据板块和字段核对'};
       })};
     }
     if(m.type==='PARSE_RESUME') {
       if(self.fixtureParseFailure)return {success:false,error:'模拟解析失败，原有草稿保留。'};
       if(self.fixtureExtraction)return {success:true,extraction:ResumeProImport.normalizeExtraction(self.fixtureExtraction,m.content)};
       return {success:true,fields:[{group:'基本信息',key:'姓名',value:'导入示例'},{group:'项目经历',key:'项目1名称',value:'新导入项目'},{group:'项目经历',key:'项目1职责',value:'实现功能'}]};
     }
     if(!storeReady)storeReady=import('/resume-store.mjs').then(mod=>mod.installResumeStore(chrome));
     await storeReady;
     return new Promise(resolve=>messageHandler(m,{id:'fixture',url:m.type==='RESUME_COLLECT'?'https://jobs.example/application':location.href,tab:{id:1}},resolve));
   }},tabs:{create:async()=>{}}};
   self.fixtureData=()=>structuredClone(data);
 });
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/popup.html');
 await page.locator('.tree-workspace').waitFor();
 assert.equal(await page.locator('[data-field-value]').first().inputValue(),'张三');
 await page.locator('[data-field-value]').first().fill('李四');
 await page.locator('[data-tree-action="save"]').click();
 await page.getByText('已保存，网申页面会自动使用更新后的资料。').waitFor();
 assert.equal(await page.evaluate(()=>fixtureData().templates[0].groups[0].fields[0].value),'李四');
 // Rename and navigate without regenerating identity or losing a click to blur rendering.
 const ids=await page.evaluate(()=>fixtureData().templates[0].groups[1].records.map(r=>r.id));
 await page.locator(`[data-tree-action="select"][data-id="${ids[0]}"]`).click();
 await page.locator('[data-record-name]').fill('示例大学 · 硕士');
 await page.locator('[data-tree-action="save"]').click();
 await page.getByText('已保存，网申页面会自动使用更新后的资料。').waitFor();
 assert.equal(await page.evaluate(()=>fixtureData().templates[0].groups[1].records[0].id),ids[0]);
 await page.locator('[data-search]').fill('机械电子');
 assert.equal(await page.locator('.tree-record').count(),1);
 await page.locator('[data-search]').fill('');
 // New and conflicting web data goes through the actual serialized store into the inbox.
 const collected=await page.evaluate(()=>chrome.runtime.sendMessage({type:'RESUME_COLLECT',templateId:'sample',fields:[{label:'英语六级',group:'语言与证书',value:'520'},{label:'项目成果',group:'项目经历',value:'完成仿真验证'}]}));
 assert.equal(collected.added,2);
 await page.locator('[data-tree-action="inbox"]').click();
 await page.locator('[data-tree-action="organize"]').click();
 await page.getByText('AI 已归纳 2 项，请逐项确认。').waitFor();
 assert.equal(await page.locator('.tree-ai-suggestion').count(),2);
 const proposal=page.locator('[data-proposal]').filter({has:page.getByRole('heading',{name:'英语六级',exact:true})});
 const record=await page.evaluate(()=>fixtureData().templates[0].groups[3].records[0].id);
 assert.equal(await proposal.locator('[data-proposal-record]').inputValue(),record,'AI destination is preselected but not committed');
 assert.ok((await proposal.locator('[data-conflict]').innerText()).includes('510'));
 await proposal.locator('[data-tree-action="accept"]').click();
 assert.equal(await page.evaluate(()=>fixtureData().templates[0].groups[3].fields[0].value),'510','accept is a draft until saved');
 // An unrelated storage refresh must not resurrect the accepted proposal.
 await page.evaluate(()=>chrome.storage.local.set({profile:{values:{},family:[],custom:[]}}));
 await page.locator('[data-tree-action="save"]').click();
 await page.getByText('已保存，网申页面会自动使用更新后的资料。').waitFor();
 assert.equal(await page.evaluate(()=>fixtureData().templates[0].groups[3].fields[0].value),'520');
 assert.equal(await page.locator('[data-proposal]').count(),1);
 // Complete a new-field insertion and preserve its provenance in backup/restore.
 const next=page.locator('[data-proposal]');
 const projectId=await page.evaluate(()=>fixtureData().templates[0].groups[2].records[0].id);
 await next.locator('[data-proposal-record]').selectOption(projectId);
 await next.locator('[data-tree-action="accept"]').click();
 await page.locator('[data-tree-action="save"]').click();
 await page.getByText('已保存，网申页面会自动使用更新后的资料。').waitFor();
 const backup=await page.evaluate(async()=>{
   const h=ResumeProTemplateImportTest,state=await h.StorageService.getState();
   const b=h.backup.buildBackup(state).backup;
   return {version:b.formatVersion,original:state.templates,restored:h.backup.parseBackup(JSON.stringify(b)).templates};
 });
 assert.equal(backup.version,3);assert.deepEqual(backup.restored,backup.original);
 // Excel remains a real importer/exporter, not a visual-only legacy button.
 const excel=await page.evaluate(async()=>{
   const h=ResumeProTemplateImportTest,template=(await h.StorageService.getState()).templates[0];
   const rows=h.backup.templateToSheetRows(template),wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),'简历');
   const bytes=XLSX.write(wb,{bookType:'xlsx',type:'array'});
   const groups=await h.parseTemplateFile(new File([bytes],'roundtrip.xlsx'));
   return {before:template.groups.flatMap(g=>g.fields.map(f=>[g.name,f.key,f.value])),after:groups.flatMap(g=>g.fields.map(f=>[g.name,f.key,f.value]))};
 });
 assert.deepEqual(excel.after,excel.before);
 // Failed requests preserve raw data; new-record suggestions require explicit creation and acceptance.
 const originalLong='完成机器人规划系统开发与仿真验证，保留详细实验设置和实现过程。'.repeat(8);
 await page.evaluate(value=>chrome.runtime.sendMessage({type:'RESUME_COLLECT',templateId:'sample',fields:[{label:'主要工作',group:'新增项目',recordIndex:1,value},{label:'开始时间',group:'新增项目',recordIndex:1,value:'2026-08'}]}),originalLong);
 await page.locator('[data-tree-action="inbox"]').click();
 await page.evaluate(()=>self.fixtureAiWait=true);
 await page.locator('[data-tree-action="organize"]').click();
 await page.locator('[data-tree-action="cancel-organize"]').click();
 await page.locator('[data-tree-status]').filter({hasText:'已停止等待 AI 归纳'}).waitFor();
 assert.equal(await page.locator('[data-proposal]').count(),2);
 assert.equal(await page.locator('[data-tree-action="cancel-organize"]').count(),0);
 await page.evaluate(()=>{self.fixtureAiWait=false;self.fixtureFinishAi?.({success:true,suggestions:[]});});
 await page.evaluate(()=>self.fixtureAiFailure=true);
 await page.locator('[data-tree-action="organize"]').click();
 await page.getByText('模拟接口离线，原始内容已保留。').waitFor();
 assert.equal(await page.locator('[data-proposal]').count(),2);
 await page.evaluate(()=>self.fixtureAiFailure=false);
 await page.locator('[data-tree-action="organize"]').click();
 await page.getByText('AI 已归纳 2 项，请逐项确认。').waitFor();
 assert.equal(await page.locator('[data-tree-action="suggested-record"]').count(),2);
 assert.equal(await page.evaluate(()=>fixtureData().templates[0].groups[2].records.length),1);
 await page.locator('[data-tree-action="suggested-record"]').first().click();
 assert.equal(await page.locator('[data-tree-action="suggested-record"]').count(),0);
 await page.locator('[data-tree-action="accept"]').first().click();
 await page.locator('[data-tree-action="accept"]').first().click();
 await page.locator('[data-tree-action="save"]').click();
 await page.getByText('已保存，网申页面会自动使用更新后的资料。').waitFor();
 const grouped=await page.evaluate(()=>{const g=fixtureData().templates[0].groups[2];const record=g.records.find(r=>r.name==='新项目B');return {count:g.records.filter(r=>r.name==='新项目B').length,fields:g.fields.filter(f=>f.recordId===record.id)};});
 assert.equal(grouped.count,1);assert.equal(grouped.fields.length,2);assert.equal(grouped.fields.find(f=>f.label==='主要工作').value,originalLong);
 await page.locator(`[data-tree-action="select"][data-id="${projectId}"]`).click();
 if(process.env.TEST_FONT_DIR)await page.addStyleTag({url:origin+'/__fonts/400.css'});
 if(process.env.TEST_FONT_DIR)await page.addStyleTag({content:'body{font-family:"Noto Sans SC",sans-serif}'});
 await page.evaluate(()=>document.fonts.ready);
 if(process.env.UI_SCREENSHOT){await page.screenshot({path:process.env.UI_SCREENSHOT,fullPage:true});}
 await page.setViewportSize({width:390,height:844});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'mobile page overflows horizontally');
 // Parsed values are a recoverable review draft. They cannot replace active facts until confirmed.
 await page.locator('#parse-toggle-button').click();
 await page.locator('#parse-file-input').setInputFiles({name:'resume.txt',mimeType:'text/plain',buffer:Buffer.from('匿名简历内容')});
 await page.locator('#parse-resume-button').click();
 await page.locator('#parse-status').filter({hasText:'已按标准资料树生成核对草稿'}).waitFor();
 await page.locator('.tree-review-banner').waitFor();
 assert.equal(await page.evaluate(()=>fixtureData().templates.length),1);
 assert.equal(await page.evaluate(()=>fixtureData().activeTemplateId),'sample');
 assert.equal(await page.locator('.tree-category').count(),18);
 assert.equal(await page.locator('[data-review-count]').innerText(),'3');
 await page.locator('[data-tree-action="save"]').click();
 await page.locator('[data-tree-status]').filter({hasText:'还有 3 项待核对'}).waitFor();
 assert.equal(await page.evaluate(()=>fixtureData().templates.length),1);
 await page.getByRole('textbox',{name:'姓名的内容',exact:true}).fill('人工修改示例');
 await page.waitForFunction(()=>fixtureData().resumeImportDraft.groups[0].fields.find(f=>f.label==='姓名').value==='人工修改示例');
 page.once('dialog',d=>d.accept());await page.reload();
 await page.locator('.tree-review-banner').waitFor();
 const resumedBasic=await page.evaluate(()=>fixtureData().resumeImportDraft.groups.find(g=>g.name==='基本信息').records[0].id);
 await page.locator(`[data-tree-action="select"][data-id="${resumedBasic}"]`).click();
 assert.equal(await page.getByRole('textbox',{name:'姓名的内容',exact:true}).inputValue(),'人工修改示例');
 assert.equal(await page.locator('[data-review-count]').innerText(),'2');
 await page.locator('[data-tree-action="review-next"]').click();
 await page.locator('[data-tree-action="review-record"]').click();
 assert.equal(await page.locator('[data-review-count]').innerText(),'0');
 await page.locator('[data-tree-action="save"]').click();
 await page.getByText('已保存，网申页面会自动使用更新后的资料。').waitFor();
 assert.equal(await page.evaluate(()=>fixtureData().templates.length),2);
 assert.equal(await page.evaluate(()=>fixtureData().resumeImportDraft),null);
 assert.equal(await page.evaluate(()=>fixtureData().templates[0].importReview.status),'confirmed');
 const reviewBackup=await page.evaluate(async()=>{const h=ResumeProTemplateImportTest,state=await h.StorageService.getState();return {original:state.templates,restored:h.backup.parseBackup(JSON.stringify(h.backup.buildBackup(state).backup)).templates};});
 assert.deepEqual(reviewBackup.restored,reviewBackup.original,'原文引用及核对状态经过备份恢复保留');
 assert.ok(await page.locator('.tree-record').count()>=2);
 // Campus catalogue edits stay in draft; existing values and IDs survive save/reload.
 await page.setViewportSize({width:1440,height:1120});
 await page.locator('[data-template-picker]').selectOption('sample');
 await page.locator(`[data-tree-action="select"][data-id="${ids[0]}"]`).click();
 const oldEducation=await page.evaluate(()=>fixtureData().templates.find(t=>t.id==='sample').groups[1].fields);
 await page.locator('[data-tree-action="complete-record"]').click();
 assert.equal(await page.getByRole('textbox',{name:'学位的内容',exact:true}).count(),1);
 assert.equal(await page.getByRole('textbox',{name:'学校名称的内容',exact:true}).count(),0,'existing 学校 is an alias');
 assert.deepEqual(await page.evaluate(()=>fixtureData().templates.find(t=>t.id==='sample').groups[1].fields),oldEducation,'changes need save');
 await page.getByRole('textbox',{name:'毕业时间的内容',exact:true}).fill('2020-06');
 assert.ok((await page.locator('[data-record-issues]').innerText()).includes('开始时间晚于结束时间'));
 await page.getByRole('textbox',{name:'毕业时间的内容',exact:true}).fill('2027-06');
 assert.equal(await page.locator('.tree-data-issue').count(),0);
 await page.locator('[data-tree-action="catalog"]').click();
 assert.equal(await page.locator('[data-section-choice]').count(),18);
 while(await page.locator('[data-section-choice]:checked').count())await page.locator('[data-section-choice]:checked').first().uncheck();
 await page.locator('[data-section-choice][value="awards"]').check();
 await page.locator('[data-tree-action="apply-catalog"]').click();
 const awardGroup=await page.locator('[data-tree-action="add-record"][aria-label="在获奖经历新增记录"]').getAttribute('data-id');
 page.once('dialog',d=>d.accept('示例奖项记录'));
 await page.locator(`[data-tree-action="add-record"][data-id="${awardGroup}"]`).click();
 assert.equal(await page.locator('[data-field-value]').count(),3);
 await page.getByRole('textbox',{name:'获奖名称的内容',exact:true}).fill('示例科技奖');
 await page.getByRole('textbox',{name:'获奖时间的内容',exact:true}).fill('2024');
 await page.locator('.tree-schema-help summary').click();
 await page.locator('[data-tree-action="add-schema-field"][data-label="奖项级别"]').click();
 await page.getByRole('textbox',{name:'奖项级别的内容',exact:true}).fill('省级');
 await page.locator('[data-tree-action="save"]').click();
 await page.getByText('已保存，网申页面会自动使用更新后的资料。').waitFor();
 await page.reload();await page.locator('.tree-workspace').waitFor();
 const campus=await page.evaluate(()=>fixtureData().templates.find(t=>t.id==='sample'));
 const award=campus.groups.find(g=>g.name==='获奖经历');
 assert.equal(award.fields.find(f=>f.label==='获奖时间').value,'2024');
 for(const f of oldEducation)assert.deepEqual(campus.groups[1].fields.find(v=>v.id===f.id),f);
 const schemaBackup=await page.evaluate(async()=>{const h=ResumeProTemplateImportTest,state=await h.StorageService.getState();return {original:state.templates,restored:h.backup.parseBackup(JSON.stringify(h.backup.buildBackup(state).backup)).templates};});
 assert.deepEqual(schemaBackup.restored,schemaBackup.original,'empty slots roundtrip in backup');
 // New templates start with empty sections, never fictitious repeated experiences.
 page.once('dialog',d=>d.accept('秋招空白资料'));
 await page.locator('[data-tree-action="create"]').click();
 await page.waitForFunction(()=>fixtureData().templates.some(t=>t.name==='秋招空白资料'));
 await page.getByRole('textbox',{name:'姓名的内容',exact:true}).waitFor();
 const created=await page.evaluate(()=>fixtureData().templates.find(t=>t.name==='秋招空白资料'));
 assert.equal(created.groups.find(g=>g.name==='获奖经历').records.length,0);
 assert.ok(created.groups.flatMap(g=>g.fields).every(f=>f.value===''));
 await page.locator('[data-tree-action="catalog"]').click();
 if(process.env.SCHEMA_SCREENSHOT)await page.screenshot({path:process.env.SCHEMA_SCREENSHOT,fullPage:true});
 await page.setViewportSize({width:390,height:844});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'catalogue mobile overflow');
 // The new structured protocol retains the exact source quote and does not populate absent abilities.
 await page.setViewportSize({width:1440,height:1120});
 await page.evaluate(()=>self.fixtureExtraction={schemaVersion:1,sections:[
  {id:'basic',records:[{name:'本人',fields:[{label:'姓名',value:'匿名候选人',evidence:'姓名：匿名候选人'}]}]},
  {id:'education',records:[{name:'示例大学',fields:[{label:'学位',value:'工学学士',evidence:'授予工学学士学位'}]}]},
  {id:'language',records:[{name:'英语',fields:[{label:'语言',value:'英语',evidence:'英语听说良好'},{label:'听说能力',value:'良好',evidence:'英语听说良好'}]}]}
 ],unclassified:[{label:'手机号',value:'13800000000（微信同号）',evidence:'手机号：13800000000（微信同号）'}]});
 await page.locator('#parse-toggle-button').click();
 await page.locator('#parse-file-input').setInputFiles({name:'structured.txt',mimeType:'text/plain',buffer:Buffer.from('姓名：匿名候选人\n授予工学学士学位\n英语听说良好\n手机号：13800000000（微信同号）')});
 const beforeModern=await page.evaluate(()=>({templates:fixtureData().templates,active:fixtureData().activeTemplateId}));
 await page.locator('#parse-resume-button').click();
 await page.locator('#parse-status').filter({hasText:'已按标准资料树生成核对草稿'}).waitFor();
 await page.locator('.tree-review-banner').waitFor();
 let modern=await page.evaluate(()=>fixtureData().resumeImportDraft);
 assert.equal(modern.groups[0].fields.find(f=>f.label==='姓名').source.quote,'姓名：匿名候选人');
 assert.equal(modern.groups[0].fields.find(f=>f.label==='姓名').source.verified,true);
 const education=modern.groups.find(g=>g.name==='教育经历'),derivedLevel=education.fields.find(f=>f.label==='学历');
 assert.equal(derivedLevel.value,'本科');assert.equal(derivedLevel.review.status,'pending');
 assert.equal(derivedLevel.source.inference.inputValue,'工学学士');assert.equal(derivedLevel.source.quote,'授予工学学士学位');
 await page.locator(`[data-tree-action="select"][data-id="${education.records[0].id}"]`).click();
 assert.match(await page.locator(`[data-field="${derivedLevel.id}"]`).innerText(),/有依据的推导.*工学学士.*本科/);
 assert.equal(modern.groups.find(g=>g.name==='语言能力').fields.find(f=>f.label==='掌握程度').value,'');
 assert.equal(modern.groups.find(g=>g.name==='语言能力').fields.find(f=>f.label==='写作能力').value,'');
 assert.deepEqual(await page.evaluate(()=>({templates:fixtureData().templates,active:fixtureData().activeTemplateId})),beforeModern);
 const workerParsed=await page.evaluate(origin=>new Promise((resolve,reject)=>{
   const worker=new Worker('/ai-worker.js');
   const timer=setTimeout(()=>{worker.terminate();reject(new Error('解析进程未回复'));},8000);
   worker.onerror=e=>{clearTimeout(timer);worker.terminate();reject(new Error(e.message));};
   worker.onmessage=({data})=>{clearTimeout(timer);worker.terminate();resolve(data.reply);};
   worker.postMessage({id:1,sender:{},message:{type:'PARSE_RESUME',content:'姓名：匿名进程示例',aiConfig:{apiUrl:origin+'/__parse_fixture',model:'fixture',apiKey:'fixture-key'}}});
 }),origin);
 assert.equal(workerParsed.success,true,'真实 AI 进程应加载共享目录及导入模块');
 assert.equal(workerParsed.extraction.sections[0].records[0].fields[0].verified,true);
 assert.equal(workerParsed.fields[0].value,'匿名进程示例');
 const unclassified=modern.groups.find(g=>g.name==='待归类资料');
 await page.locator(`[data-tree-action="select"][data-id="${unclassified.records[0].id}"]`).click();
 await page.locator(`[data-tree-action="move-field"][data-id="${unclassified.fields[0].id}"]`).click();
 await page.locator('[data-move-target]').selectOption(modern.groups[0].records[0].id);
 await page.waitForFunction(()=>fixtureData().resumeImportDraft.groups[0].fields.some(f=>f.label==='手机号'&&f.value==='13800000000（微信同号）'));
 modern=await page.evaluate(()=>fixtureData().resumeImportDraft);
 assert.equal(modern.groups[0].fields.find(f=>f.label==='手机号').id,unclassified.fields[0].id);
 await page.locator(`[data-tree-action="select"][data-id="${modern.groups[0].records[0].id}"]`).click();
 if(process.env.REVIEW_DESKTOP_SCREENSHOT)await page.screenshot({path:process.env.REVIEW_DESKTOP_SCREENSHOT,fullPage:true});
 await page.evaluate(()=>self.fixtureParseFailure=true);
 await page.locator('#parse-file-input').setInputFiles({name:'failed.txt',mimeType:'text/plain',buffer:Buffer.from('读取失败测试')});
 page.once('dialog',d=>d.accept());await page.locator('#parse-resume-button').click();
 await page.locator('#parse-status').filter({hasText:'模拟解析失败'}).waitFor();
 assert.deepEqual(await page.evaluate(()=>fixtureData().resumeImportDraft),modern,'解析失败不能丢弃上一份核对草稿');
 await page.setViewportSize({width:390,height:844});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'review draft mobile overflow');
 if(process.env.REVIEW_SCREENSHOT)await page.screenshot({path:process.env.REVIEW_SCREENSHOT,fullPage:true});
 page.once('dialog',d=>d.accept());await page.locator('[data-tree-action="reload"]').click();
 assert.equal(await page.evaluate(()=>fixtureData().resumeImportDraft),null);
 assert.deepEqual(await page.evaluate(()=>({templates:fixtureData().templates,active:fixtureData().activeTemplateId})),beforeModern);
 assert.deepEqual(errors,[]);
 console.log('PASS: manager/inbox/backup/Excel, 18-section structured extraction, quote retention, pending-save block, autosave/reopen, human review, confirm/activate, parse failure preservation, discard draft, mobile layout');
 await context.close();
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>server.close());
