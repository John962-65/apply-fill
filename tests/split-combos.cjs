// Split year/month custom dropdowns, with real trusted CDP clicks and node replacement.
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH,args:['--no-sandbox']});
 try{
  const {performInput}=await import('../browser-input.mjs');
  for(const mode of ['normal','rerender','duplicate-month']){
   const page=await browser.newPage({viewport:{width:1100,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
   const cdp=await page.context().newCDPSession(page);await page.exposeFunction('realInput',action=>performInput((m,p)=>cdp.send(m,p),action));
   await page.route('https://fixture.invalid/**',route=>route.fulfill({contentType:'text/html',body:fs.readFileSync(path.join(__dirname,'fixtures/phoenix-controls.html'),'utf8')}));
   await page.goto('https://fixture.invalid/form');
   await page.evaluate(mode=>{
    self.mode=mode;self.__RESUME_PRO_TEST__=true;
    const part=(id)=>`<div class="date-part"><div id="${id}" class="phoenix-select"></div></div>`;
    const endpoint=id=>`<div class="endpoint">${part(id+'-year')}${part(id+'-month')}</div>`;
    document.querySelector('main').innerHTML='<section><h2>教育背景</h2>'+[1,2].map(n=>`<article class="record"><div class="form-item--phoenix"><div class="field-label">就读时间</div><div class="period">${endpoint('e'+n+'-a')}<span>至</span>${endpoint('e'+n+'-b')}</div></div><div class="form-item--phoenix"><label>学校名称<input id="school-${n}"></label></div><div class="form-item--phoenix"><label>专业名称<input id="major-${n}"></label></div></article>`).join('')+'</section>';
    document.querySelectorAll('main .phoenix-select').forEach(node=>{
     const year=node.id.endsWith('year');node.dataset.choices=JSON.stringify(year?['2020年','2024年','2027年']:mode==='duplicate-month'?['9月','09月']:['1月','6月','9月']);renderControl(node);node.querySelector('input').placeholder=year?'年':'月';
    });
    const host=document.createElement('div');host.id='resume-pro-sidebar';document.body.append(host);
    self.chrome={runtime:{id:'fixture',getURL:()=>'',getManifest:()=>({version:'test'}),sendMessage:async m=>m.type==='BROWSER_INPUT'?realInput(m.action):{}},storage:{local:{get:async()=>({}),set:async()=>{}},onChanged:{addListener(){}}}};
   },mode);
   for(const script of JSON.parse(fs.readFileSync(path.join(root,'manifest.json'))).content_scripts[0].js)await page.addScriptTag({path:path.join(root,script)});
   const result=await page.evaluate(async()=>{
    const api=ResumeProHighlightTest,shadow=document.getElementById('resume-pro-sidebar').attachShadow({mode:'open'});shadow.innerHTML='<input id="resume-pro-browser-input" type="checkbox" checked>';api.setShadowRoot(shadow);
    const scan=api.scanFillableFields(),parts=scan.fields.filter(f=>/^e1-/.test(f.idAttr)),results=[];
    for(const meta of parts){
     const entry=api.refreshFieldEntry(meta,scan.fieldMap.get(meta.fieldId));entry.meta=meta;entry.decide=async()=>{throw new Error('date part with an exact option needs no planner');};
     const value=meta.datePart==='year'?(meta.rangeRole==='start'?'2024':'2027'):(meta.rangeRole==='start'?'09':'06');
     const ok=Boolean(await api.setElementValue(entry,value));results.push({id:meta.idAttr,ok,verified:api.verifyFilledValue(entry,value,meta.inputType),value:api.readBackValue(entry),note:entry.fillNote});
    }
    return {fields:parts.map(f=>({group:f.group,recordIndex:f.recordIndex,datePart:f.datePart,rangeRole:f.rangeRole})),results,actions,wrong:unrelatedClicks,other:Array.from(document.querySelectorAll('[id^="e2-"]'),e=>e.querySelector('input').value)};
   });
   assert.equal(result.fields.length,4);assert.ok(result.fields.every(f=>f.group==='教育背景'&&f.recordIndex===1));
   assert.deepEqual(result.fields.map(f=>[f.datePart,f.rangeRole]),[['year','start'],['month','start'],['year','end'],['month','end']]);
   if(mode==='duplicate-month'){
    assert.equal(result.results[1].ok,false);assert.equal(result.results[1].value,'');assert.match(result.results[1].note,/多个同名选项/);
   }else{
    assert.ok(result.results.every(r=>r.ok&&r.verified),JSON.stringify(result));assert.deepEqual(result.results.map(r=>r.value),['2024年','9月','2027年','6月']);
   }
   assert.equal(result.wrong,0);assert.ok(result.actions.every(a=>a.trusted));assert.ok(result.other.every(value=>value===''));assert.deepEqual(errors,[]);
   console.log('PASS trusted year/month custom selectors:',mode);await page.close();
  }
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
