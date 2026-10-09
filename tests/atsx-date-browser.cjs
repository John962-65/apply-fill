const {chromium}=require('playwright'),fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH,args:['--no-sandbox']});
 try{
  const {performInput}=await import('../browser-input.mjs');
  const results=[];
  for(const mode of ['normal','reuse','rerender-label','discard','late-discard','wrong-end','duplicate']){
   const page=await browser.newPage({viewport:{width:1100,height:850}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
   const cdp=await page.context().newCDPSession(page);await page.exposeFunction('realInput',a=>performInput((m,p)=>cdp.send(m,p),a));
   await page.route('https://fixture.invalid/**',r=>r.fulfill({contentType:'text/html',body:fs.readFileSync(path.join(__dirname,'fixtures/atsx-period.html'),'utf8')}));
   await page.goto('https://fixture.invalid/form');
   await page.evaluate(mode=>{self.mode=mode;self.__RESUME_PRO_TEST__=true;const h=document.createElement('div');h.id='resume-pro-sidebar';document.body.append(h);self.chrome={runtime:{id:'fixture',getURL:()=>'',getManifest:()=>({version:'test'}),sendMessage:async m=>m.type==='BROWSER_INPUT'?realInput(m.action):{}},storage:{local:{get:async()=>({}),set:async()=>{}},onChanged:{addListener(){}}}};},mode);
   for(const script of JSON.parse(fs.readFileSync(path.join(__dirname,'../manifest.json'))).content_scripts[0].js)await page.addScriptTag({path:path.join(__dirname,'..',script)});
   const r=await page.evaluate(async()=>{
    const api=ResumeProHighlightTest,h=document.getElementById('resume-pro-sidebar').attachShadow({mode:'open'});h.innerHTML='<input id="resume-pro-browser-input" type="checkbox" checked>';api.setShadowRoot(h);
    const scan=api.scanFillableFields(),dates=scan.fields.filter(f=>f.rangeId?.startsWith('period-'));
    if(dates.length!==4)return {count:dates.length};
    const a=scan.fieldMap.get(dates[0].fieldId),b=scan.fieldMap.get(dates[1].fieldId);
    const first=await api.setElementValue(a,'2020-10');
    const second=first.ok?await api.setElementValue(b,'2022-12'):null;
    const year=scan.fields.find(f=>f.idAttr==='award-year');
    const yr=mode==='normal'?await api.setElementValue(scan.fieldMap.get(year.fieldId),'2010'):null;
    const labels=[...document.querySelectorAll('.atsx-date-picker-period-month-label')].map(n=>n.textContent.trim());
    return {count:dates.length,roles:dates.map(f=>f.rangeRole),labels,first,second,yr,year:document.getElementById('award-year').value,untrusted:actions.filter(a=>!a.trusted).length};
   });
   assert.equal(r.count,4,JSON.stringify(r));assert.deepEqual(r.roles,['start','end','start','end']);assert.equal(r.untrusted,0);
   if(['normal','reuse','rerender-label'].includes(mode)){assert.equal(r.first.ok,true,JSON.stringify(r));assert.equal(r.second.ok,true,JSON.stringify(r));assert.deepEqual(r.labels,['2020-10','2022-12','YYYY-MM','YYYY-MM']);}
   else assert.equal(r.first.ok,false,JSON.stringify(r));
   if(mode==='normal'){assert.equal(r.yr.ok,true,JSON.stringify(r));assert.equal(r.year,'2010');}
   assert.deepEqual(errors,[]);results.push(mode);await page.close();
  }
  console.log('PASS ATSX actual-shape DOM + CDP:',results.join(', '));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
