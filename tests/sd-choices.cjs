// Reported sd-* class shells with separate captions and literal date separators.
// Anonymous behavior fixture; this does not validate the user's private page.
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
(async()=>{
 const {performInput}=await import('../browser-input.mjs');
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH,args:['--no-sandbox']});
 try{
  for(const mode of ['manual-caption','manual-readonly','mirrored-query','hidden-discard','sd-discard','sd-late-discard','unresolved']){
   const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   const cdp=await page.context().newCDPSession(page);await page.exposeFunction('realInput',action=>performInput((m,p)=>cdp.send(m,p),action));
   await page.route('https://fixture.invalid/**',r=>r.fulfill({contentType:'text/html',body:fs.readFileSync(path.join(__dirname,'fixtures/split-resume.html'),'utf8')}));
   await page.goto('https://fixture.invalid/form?mode='+(mode.startsWith('sd-')?mode:'sd-caption'));
   await page.evaluate(mode=>{
    self.__RESUME_PRO_TEST__=true;self.testMode=mode;
    const host=document.createElement('div');host.id='resume-pro-sidebar';document.body.append(host);
    self.chrome={runtime:{id:'fixture',getManifest:()=>({version:'test'}),getURL:()=>'',sendMessage:async m=>m.type==='BROWSER_INPUT'?realInput(m.action):{}},storage:{local:{get:async()=>({}),set:async()=>{}},onChanged:{addListener(){}}}};
    const input=document.getElementById('school-1'),caption=input.parentElement.querySelector('.caption');
    if(mode==='manual-caption')caption.textContent='人工保留的学校';
    if(mode==='manual-readonly'){input.readOnly=true;input.value='人工保留的学校';}
    if(mode==='mirrored-query'){input.value='待核对搜索文字';caption.textContent=input.value;}
    if(mode==='hidden-discard'){
     const hidden=document.createElement('input');hidden.type='hidden';hidden.name='selectedId';input.parentElement.append(hidden);
    }
    if(mode==='unresolved'){
     const period=document.querySelector('[data-record="education-1"] .period');
     [...period.childNodes].filter(n=>n.nodeType===Node.TEXT_NODE).forEach(n=>n.remove());
     // Separators in hidden help text or an unrelated option list prove nothing.
     const fake=document.createElement('span');fake.hidden=true;fake.textContent='-';period.children[0].after(fake);
     const popup=document.createElement('div');popup.setAttribute('role','listbox');popup.innerHTML='<span>-</span>';period.children[0].after(popup);
    }
   },mode);
   for(const script of JSON.parse(fs.readFileSync(path.join(root,'manifest.json'))).content_scripts[0].js)await page.addScriptTag({path:path.join(root,script)});
   const result=await page.evaluate(async()=>{
    const api=ResumeProHighlightTest,shadow=document.getElementById('resume-pro-sidebar').attachShadow({mode:'open'});
    shadow.innerHTML='<input id="resume-pro-browser-input" type="checkbox" checked>';api.setShadowRoot(shadow);
    const scan=api.scanFillableFields(),parts=scan.fields.filter(f=>/^education-1-[ab]-/.test(f.idAttr));
    if(testMode==='unresolved')return {parts};
    const meta=scan.fields.find(f=>f.idAttr===(testMode.startsWith('sd-')?'education-1-a-year':'school-1')),entry=scan.fieldMap.get(meta.fieldId);entry.meta=meta;
    const before=api.readBackValue(entry),existing=api.hasExistingValue(entry);
    const ok=await api.setElementValue(entry,testMode.startsWith('sd-')?'2024':'示例大学');
    const after=api.readBackValue(entry),fresh=api.scanFillableFields(),collected=api.readFilledFields();
    return {before,existing,ok:!!ok,after,note:entry.fillNote,stats:sdStats,open:document.querySelectorAll('.sd-choice-list').length,collected,
     freshLabel:fresh.fields.find(f=>f.idAttr==='school-1').label};
   });
   if(mode==='unresolved'){
    assert.equal(result.parts.length,4);assert.ok(result.parts.every(f=>f.dateRangeUnresolved&&!f.rangeId),JSON.stringify(result));
   }else{
    assert.equal(result.freshLabel,'学校名称');assert.equal(result.open,0);assert.equal(result.stats.untrusted,0);
    if(mode.startsWith('manual-')){
     assert.equal(result.before,'人工保留的学校');assert.equal(result.existing,true);assert.equal(result.after,result.before);assert.equal(result.stats.selected,0);
    }else{
     assert.equal(result.ok,false,JSON.stringify(result));assert.equal(result.after,'');
     assert.ok(!result.collected.some(f=>f.value==='示例大学'||f.value==='待核对搜索文字'),JSON.stringify(result));
     if(mode==='mirrored-query')assert.equal(result.stats.selected,0);
    }
   }
   assert.deepEqual(errors,[]);console.log('PASS sd caption/date safeguards:',mode);await page.close();
  }
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
