const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const FIXTURE=fs.readFileSync(path.join(__dirname,'fixtures/unknown-date-picker.html'),'utf8');
const POLICY=/const POLICY=`([\s\S]*?)`;/.exec(fs.readFileSync(path.join(root,'tests/date-benchmark.cjs'),'utf8'))[1];
(async()=>{
 const {performInput}=await import('../browser-input.mjs');
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH,args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1100,height:900}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const cdp=await page.context().newCDPSession(page);
 await page.exposeFunction('realInput',a=>performInput((m,p)=>cdp.send(m,p),a));
 await page.route('https://fixture.invalid/**',r=>r.fulfill({contentType:'text/html',body:FIXTURE}));
 await page.goto('https://fixture.invalid/form?mode=messy');
 await page.evaluate(()=>{
  const host=document.createElement('div');host.id='resume-pro-sidebar';document.body.append(host);
  host.attachShadow({mode:'open'});
 });
 await page.evaluate(()=>{
  self.__RESUME_PRO_TEST__=true;
  self.__APPLY_FILL_DATE_MODE__='agent-only';
  self.__APPLY_FILL_DATE_DISABLE_CONTRACT__=true;
  self.chrome={runtime:{id:'fixture',getManifest:()=>({version:'test'}),getURL:p=>location.origin+'/'+p,sendMessage:async m=>{
    if(m.type==='BROWSER_INPUT')return realInput(m.action);
    return {ready:true};
  }},storage:{local:{get:async()=>({}),set:async()=>{}},onChanged:{addListener(){}}}};
 });
 for(const s of JSON.parse(fs.readFileSync(path.join(root,'manifest.json'))).content_scripts[0].js)await page.addScriptTag({path:path.join(root,s)});
 const out=await page.evaluate(async (POLICY)=>{
  const api=ResumeProHighlightTest;
  api.setShadowRoot(document.getElementById('resume-pro-sidebar').shadowRoot);
  const scan=api.scanFillableFields();
  const field=scan.fields.find(f=>scan.fieldMap.get(f.fieldId).element?.id==='edu-start');
  const entry=scan.fieldMap.get(field.fieldId);entry.meta=field;
  const steps=[];
  entry.decide=async o=>{
    const policy=(new Function('return '+POLICY))();
    const c=o.candidates||[];
    const action=await policy(o);
    steps.push({n:steps.length,action:action.id,modes:o.panel&&o.panel.modes,header:o.panel&&o.panel.header,
      tier2:c.filter(x=>x.kind==='click-element').map(x=>x.label).slice(0,4),value:document.getElementById('edu-start').value});
    return action;
  };
  const result=await api.fillDateWithAgent(entry,'2024-09-15',entry.meta);
  return {result,value:document.getElementById('edu-start').value,note:entry.fillNote,steps,interactions:entry.interactions};
 },POLICY);
 out.errors=errors;
 console.log(JSON.stringify(out,null,1));
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
