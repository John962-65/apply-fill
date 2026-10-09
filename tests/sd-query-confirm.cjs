// Anonymous sibling popup without listbox/option/expanded semantics. A typed
// query, even mirrored in the caption, must be followed by a real option click.
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
(async()=>{
 const {performInput}=await import('../browser-input.mjs');
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH,args:['--no-sandbox']});
 try{
  for(const mode of process.env.SD_QUERY_MODES?.split(',')||['sd-sibling','sd-sibling-month','sd-sibling-old-query','sd-sibling-readonly-query','sd-sibling-reject','sd-sibling-sticky','sd-sibling-known-sticky']){
   const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   const cdp=await page.context().newCDPSession(page);await page.exposeFunction('realInput',action=>performInput((m,p)=>cdp.send(m,p),action));
   await page.route('https://fixture.invalid/**',r=>r.fulfill({contentType:'text/html',body:fs.readFileSync(path.join(__dirname,'fixtures/split-resume.html'),'utf8')}));
   await page.goto('https://fixture.invalid/form?mode='+(mode==='sd-sibling-known-sticky'?'sd-sibling-sticky':mode));
   await page.evaluate(mode=>{
    self.__RESUME_PRO_TEST__=true;
    const host=document.createElement('div');host.id='resume-pro-sidebar';document.body.append(host);
    self.chrome={runtime:{id:'fixture',getManifest:()=>({version:'test'}),getURL:()=>'',sendMessage:async m=>m.type==='BROWSER_INPUT'?realInput(m.action):{}},storage:{local:{get:async()=>({}),set:async()=>{}},onChanged:{addListener(){}}}};
    // Reproduce a previous attempt that left query + candidate menu open.
    const input=document.getElementById(mode==='sd-sibling-month'?'education-1-a-month':'education-1-a-year');
    if(mode==='sd-sibling-known-sticky')input.parentElement.querySelector('.caption').classList.add('el-select__selected-item');
    if(mode==='sd-sibling-readonly-query')input.readOnly=true;
    input.value=mode==='sd-sibling-month'?'09':mode==='sd-sibling-old-query'?'2025':'2024';input.dispatchEvent(new Event('input',{bubbles:true}));
    self.targetId=input.id;self.targetValue=mode==='sd-sibling-month'?'09':'2024';
   },mode);
   await page.waitForTimeout(150);
   for(const script of JSON.parse(fs.readFileSync(path.join(root,'manifest.json'))).content_scripts[0].js)await page.addScriptTag({path:path.join(root,script)});
   const result=await page.evaluate(async()=>{
    const api=ResumeProHighlightTest,shadow=document.getElementById('resume-pro-sidebar').attachShadow({mode:'open'});
    shadow.innerHTML='<input id="resume-pro-browser-input" type="checkbox" checked>';api.setShadowRoot(shadow);
    const scan=api.scanFillableFields(),meta=scan.fields.find(f=>f.idAttr===targetId),entry=scan.fieldMap.get(meta.fieldId);entry.meta=meta;
    const before=api.readBackValue(entry),existing=api.hasExistingValue(entry);
    const ok=await api.setElementValue(entry,targetValue);
    return {before,existing,ok:!!ok,after:api.readBackValue(entry),note:entry.fillNote,trace:entry.interactions,
     chosen:sdChosen[targetId]||'',stats:sdStats,open:document.querySelectorAll('.floating-a91').length,
     collected:api.readFilledFields(),query:document.getElementById(targetId).value};
   });
   assert.equal(result.before,'');assert.equal(result.existing,false);assert.equal(result.stats.untrusted,0);
   assert.equal(result.open,0,JSON.stringify(result));
   if(!['sd-sibling-reject','sd-sibling-sticky','sd-sibling-known-sticky'].includes(mode)){
    const expected=mode==='sd-sibling-month'?'9月':'2024年';
    assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.chosen,expected);assert.equal(result.stats.selected,1);
    assert.equal(result.after,expected);assert.equal(result.query,'');
   }else{
    assert.equal(result.ok,false,JSON.stringify(result));assert.equal(result.stats.selected,0);assert.equal(result.chosen,'');
    assert.equal(result.after,'');assert.ok(!result.collected.some(f=>f.value==='2024年'));
   }
   assert.deepEqual(errors,[]);console.log('PASS sibling query requires committed choice:',mode);await page.close();
  }
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
