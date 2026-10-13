// A page-identity failure on the first complex control must stop the fill run.
const {chromium}=require('playwright');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const fixture=fs.readFileSync(path.join(__dirname,'fixtures/run-context-change.html'),'utf8');

(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined,headless:true,args:['--no-sandbox']});
 try{
  for(const phase of ['before-input','during-input']){
   const page=await browser.newPage({viewport:{width:1100,height:900}}),errors=[];
   page.on('pageerror',error=>errors.push(error.message));
   await page.route('https://fixture.invalid/**',route=>route.fulfill({contentType:'text/html',body:fixture}));
   await page.goto('https://fixture.invalid/apply');
   await page.evaluate(phase=>{
   self.__INPUT_PHASE__=phase;
   self.__RESUME_PRO_TEST__=true;
   self.fillFacts={'学校名称':'示例大学','学历':'硕士'};
   self.fillStore={templates:[{id:'t',name:'匿名资料',groups:[{id:'edu',name:'教育背景',fields:Object.entries(fillFacts).map(([key,value],i)=>({id:'f'+i,key,label:key,value}))}]}],activeTemplateId:'t',profile:{values:{},family:[],custom:[]},aiConfig:{apiUrl:'https://fixture.invalid/v1/chat/completions',model:'fixture',apiKey:'fixture'}};
   self.browserInputRequests=[];
   self.chrome={
    runtime:{id:'fixture-extension',getManifest:()=>({version:'test'}),getURL:relative=>new URL(relative,location.origin+'/').href,sendMessage:async message=>{
     if(message.type==='BROWSER_INPUT'){
      browserInputRequests.push(message.action.kind);
      return {ok:false,errorCode:'input_page_changed',error:'招聘页面文档已变化，请重新扫描后填写',phase:__INPUT_PHASE__};
     }
     if(message.type==='AI_FILL')return {success:true,matches:message.formFields.map(field=>({
      fieldId:field.fieldId,value:fillFacts[field.label],source:'ai',resumeKey:field.label,
      relation:'exact',resumeGroup:'教育背景',resumeGroupId:'edu',resumeRecordId:'record-1',resumeFieldId:field.label
     })).filter(match=>match.value)};
     if(message.type==='ENSURE_AI_HOST')return {ready:true};
     return {success:true,ready:true};
    }},
    storage:{local:{get:async()=>structuredClone(fillStore),set:async changes=>Object.assign(fillStore,changes)},onChanged:{addListener(){}}}
   };
   const host=document.createElement('div');host.id='resume-pro-sidebar';document.body.append(host);
   const shadow=host.attachShadow({mode:'open'});
   shadow.innerHTML='<button id="resume-pro-ai-fill">填写</button><div id="resume-pro-status"></div>'
    +'<input type="checkbox" id="resume-pro-generic-date"><input type="checkbox" id="resume-pro-browser-input" checked>'
    +'<details id="resume-pro-diagnostics"><textarea id="resume-pro-diagnostics-text"></textarea></details>'
    +'<details id="resume-pro-trace"><textarea id="resume-pro-trace-text"></textarea></details>'
    +'<details id="resume-pro-structures"><textarea id="resume-pro-structures-text"></textarea></details>';
   },phase);
   for(const script of JSON.parse(fs.readFileSync(path.join(root,'manifest.json'))).content_scripts[0].js)
    await page.addScriptTag({path:path.join(root,script)});
   const result=await page.evaluate(async()=>{
   const api=ResumeProHighlightTest,host=document.getElementById('resume-pro-sidebar'),shadow=host.shadowRoot;
   api.setShadowRoot(shadow);api.setCurrentStore(fillStore);
   const scan=api.scanFillableFields();
   const labels=scan.fields.map(field=>field.label);
   await api.handleAiFillClick({currentTarget:shadow.querySelector('#resume-pro-ai-fill')});
   return {labels,requests:browserInputRequests.slice(),status:shadow.querySelector('#resume-pro-status').textContent,
    diagnostics:shadow.querySelector('#resume-pro-diagnostics-text').value,trace:shadow.querySelector('#resume-pro-trace-text').value,
    values:[document.getElementById('school').value,document.getElementById('degree').value]};
   });

   assert.ok(result.labels.includes('学校名称')&&result.labels.includes('学历'),JSON.stringify(result));
   assert.deepEqual(result.requests,['click'],'the second complex field must never reach the browser input channel');
   assert.match(result.diagnostics,/RUN_CONTEXT_CHANGED/);
   assert.deepEqual(result.values,['','']);
   assert.deepEqual(errors,[]);
   if(phase==='before-input'){
    assert.match(result.diagnostics,/尚未尝试：2/);
    assert.match(result.trace,/FAILED_PRECHECK \/ RUN_CONTEXT_CHANGED/);
   }else{
    assert.match(result.diagnostics,/操作结果未确认：1/);
    assert.match(result.diagnostics,/尚未尝试：1/);
    assert.match(result.trace,/BLOCKED \/ RUN_CONTEXT_CHANGED/);
    assert.match(result.trace,/FAILED_PRECHECK \/ RUN_CONTEXT_CHANGED/);
   }
   await page.close();
  }
  console.log('PASS fill run stops on precheck and mid-input document identity failures');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
