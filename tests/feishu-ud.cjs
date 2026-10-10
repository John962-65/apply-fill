const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
(async()=>{
 const {performInput}=await import('../browser-input.mjs');
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH,args:['--no-sandbox']});
 try{
  for(const mode of ['success','select-discard','date-discard','ambiguous','rerender','peer-change','day','day-bare']){
   const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   const cdp=await page.context().newCDPSession(page);await page.exposeFunction('realInput',action=>performInput((m,p)=>cdp.send(m,p),action));
   await page.route('https://fixture.invalid/**',r=>r.fulfill({contentType:'text/html',body:fs.readFileSync(path.join(__dirname,'fixtures/feishu-ud.html'),'utf8')}));
   await page.goto('https://fixture.invalid/form?mode='+mode);
   await page.evaluate(()=>{
    self.__RESUME_PRO_TEST__=true;
    const host=document.createElement('div');host.id='resume-pro-sidebar';document.body.append(host);
    self.chrome={runtime:{id:'fixture',getManifest:()=>({version:'test'}),getURL:()=>'',sendMessage:async m=>m.type==='BROWSER_INPUT'?realInput(m.action):{}},storage:{local:{get:async()=>({}),set:async()=>{}},onChanged:{addListener(){}}}};
   });
   for(const script of JSON.parse(fs.readFileSync(path.join(root,'manifest.json'))).content_scripts[0].js)await page.addScriptTag({path:path.join(root,script)});
   const result=await page.evaluate(async mode=>{
    const api=ResumeProHighlightTest,shadow=document.getElementById('resume-pro-sidebar').attachShadow({mode:'open'});
    shadow.innerHTML='<input id="resume-pro-browser-input" type="checkbox" checked>';api.setShadowRoot(shadow);
    const scan=api.scanFillableFields();
    const describe=id=>{const f=scan.fields.find(f=>f.idAttr===id);if(!f)throw Error('missing '+id);const e=scan.fieldMap.get(f.fieldId);e.meta=f;return {f,e};};
    const combo=scan.fields.filter(f=>f.inputType==='combobox').map(f=>({label:f.label,trigger:scan.fieldMap.get(f.fieldId).trigger.className}));
    const date=describe('start'),end=describe('end');date.e.rangePeer=end.e;
    const fields=scan.fields.map(f=>({id:f.idAttr,label:f.label,inputType:f.inputType}));
    const label=api.getFieldLabel(document.getElementById('missing'));
    let comboOk=null,dateOk=null,birthOk=null,notes='';
    if(['success','select-discard'].includes(mode)){
     const f=scan.fields.find(f=>f.label==='性别'),e=scan.fieldMap.get(f.fieldId);e.meta=f;
     comboOk=await api.setElementValue(e,'男');notes=e.fillNote||'';
    }
    if(mode!=='select-discard'){
     dateOk=await api.setElementValue(date.e,mode.startsWith('day')?'2025-04-03':'2024-09');notes=date.e.fillNote||'';
     if(mode==='success')birthOk=await api.setElementValue(describe('birth').e,'2002-03-15');
    }
    return {fields,combo,label,comboOk,dateOk,birthOk,notes,read:api.readBackValue(date.e),raw:document.getElementById('start').value,
     collected:api.readFilledFields(),stats,open:document.querySelectorAll('.anonymous-calendar,.anonymous-options').length,
     capture:api.scanCaptureTargets().filter(t=>t.node.closest('.ud__select')).map(t=>t.node.className)};
   },mode);
   assert.equal(result.label,'','missing label must not borrow 学校名称 or 姓名');
   assert.ok(result.fields.some(f=>f.id==='phone'&&f.label==='手机号'),JSON.stringify(result.fields));
   assert.deepEqual(result.combo.map(c=>c.label),['手机区号','性别','学历']);
   assert.ok(result.combo.every(c=>c.trigger.includes('ud__select__selector')&&!c.trigger.includes('search__input')));
   assert.ok(result.capture.every(c=>c.includes('ud__select__selector')));assert.equal(result.stats.untrusted,0);
   if(mode==='success'||mode==='rerender'||mode.startsWith('day')){
    assert.equal(result.dateOk.ok,true,JSON.stringify(result));assert.equal(result.read,mode==='day-bare'?'2025年4月3日':mode==='day'?'2025-04-03':'2024-09');assert.ok(result.stats.confirmations>0);
    assert.equal(result.open,0);if(mode==='success'){assert.equal(result.comboOk,true,JSON.stringify(result));assert.equal(result.birthOk.ok,true);assert.equal(result.birthOk.value,'2002-03');}
   }else if(mode==='select-discard'){
    assert.equal(result.comboOk,false);assert.ok(!result.collected.some(f=>f.label==='性别'&&f.value==='男'));
   }else{
    assert.equal(result.dateOk.ok,false,JSON.stringify(result));assert.equal(result.read,'');
    assert.ok(!result.collected.some(f=>f.idAttr==='start'&&f.value==='2024-09'));
    if(mode==='date-discard')assert.equal(result.stats.confirmations,1,'a rejected confirmation must not be clicked repeatedly');
    if(mode==='ambiguous')assert.equal(result.stats.selections,0);
   }
   assert.deepEqual(errors,[]);console.log('PASS captured UD shells / synthetic commit behavior:',mode);await page.close();
  }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
