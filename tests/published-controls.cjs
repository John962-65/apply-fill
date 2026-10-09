// Runs the actual pinned npm components, not a reimplementation of their widgets.
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const modules=process.env.APPLYFILL_PUBLIC_COMPONENT_MODULES||path.join(__dirname,'published-controls/node_modules');
const esbuild=require(path.join(modules,'esbuild'));
(async()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'applyfill-controls-'));
 let browser;
 try{
  for(const name of ['vue.js','react.jsx'])await esbuild.build({entryPoints:[path.join(__dirname,'fixtures/published-controls.'+name)],outfile:path.join(tmp,name+'.js'),bundle:true,nodePaths:[modules],define:{'process.env.NODE_ENV':'"production"'}});
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH,args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:1200,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const cdp=await page.context().newCDPSession(page),{performInput}=await import('../browser-input.mjs');
  await page.exposeFunction('realInput',action=>performInput((m,p)=>cdp.send(m,p),action));
  await page.route('https://fixture.invalid/**',route=>route.fulfill({contentType:'text/html',body:fs.readFileSync(path.join(__dirname,'fixtures/published-controls.html'),'utf8')}));
  await page.goto('https://fixture.invalid/form');
  for(const css of ['element-ui/lib/theme-chalk/index.css','view-design/dist/styles/iview.css'])await page.addStyleTag({path:path.join(modules,css)});
  for(const name of ['vue.js','react.jsx'])await page.addScriptTag({path:path.join(tmp,name+'.js')});
  await page.waitForSelector('#react-language');
  await page.evaluate(()=>{
   self.__RESUME_PRO_TEST__=true;const host=document.createElement('div');host.id='resume-pro-sidebar';document.body.append(host);
   self.chrome={runtime:{id:'fixture',getManifest:()=>({version:'test'}),getURL:()=>'',sendMessage:async m=>m.type==='BROWSER_INPUT'?realInput(m.action):{}},storage:{local:{get:async()=>({}),set:async()=>{}},onChanged:{addListener(){}}}};
   document.querySelectorAll('[data-test]').forEach(n=>{const input=n.querySelector('input');if(input)input.id=n.dataset.test;});
  });
  for(const script of JSON.parse(fs.readFileSync(path.join(__dirname,'../manifest.json'))).content_scripts[0].js)await page.addScriptTag({path:path.join(__dirname,'..',script)});
  await page.evaluate(()=>{
   const api=ResumeProHighlightTest,shadow=document.getElementById('resume-pro-sidebar').attachShadow({mode:'open'});
   shadow.innerHTML='<input id="resume-pro-browser-input" type="checkbox" checked>';api.setShadowRoot(shadow);
   document.querySelectorAll('[data-test]').forEach(n=>{const widget=n.querySelector(ResumeProControlCatalog.selector('selectRoot'));if(widget)widget.id=n.dataset.test;});
   self.scan=api.scanFillableFields();
  });
  const metas=await page.evaluate(()=>scan.fields.map(f=>({id:f.idAttr,label:f.label,type:f.inputType,family:f.controlFamily,record:f.recordIndex})));
  assert.equal(metas.length,16,JSON.stringify(metas));
  for(const family of ['element','iview','ant'])for(const mode of ['month','day','year']){
   const id=family+'-'+mode,value=mode==='day'?'2025-04-03':mode==='month'?'2022-02':'2002';
   const f=metas.find(f=>f.id===id);assert.equal(f.type,'date-picker',JSON.stringify(f));
   assert.equal(f.family,family==='ant'?'ant-picker':family);
   const result=await page.evaluate(async({id,value})=>{
    const api=ResumeProHighlightTest,f=scan.fields.find(f=>f.idAttr===id),entry=scan.fieldMap.get(f.fieldId);
    const result=await api.setElementValue(entry,value);
    return {result,actual:api.readBackValue(entry),state:window.values[id],trace:entry.interactions,note:entry.fillNote};
   },{id,value});
   assert.equal(result.result.ok,true,id+JSON.stringify(result));assert.equal(result.actual,value,id+JSON.stringify(result));
   assert.ok(result.state?.startsWith(value),id+JSON.stringify(result));console.log('PASS real component + CDP:',id,value);
  }
  for(const id of ['element-language','iview-language','react-language']){
   const result=await page.evaluate(async id=>{
    const api=ResumeProHighlightTest,f=scan.fields.find(f=>f.idAttr===id),entry=scan.fieldMap.get(f.fieldId);
    const result=await api.setElementValue(entry,'英语');return {result,actual:api.readBackValue(entry),note:entry.fillNote,trace:entry.interactions,state:window.values[id],html:result?undefined:entry.root.outerHTML,clicks:result?undefined:window.clicks.slice(-4)};
   },id);
   assert.equal(result.result,true,id+JSON.stringify(result));assert.equal(result.actual,'英语');console.log('PASS real component + CDP:',id);
  }
  const protectedResult=await page.evaluate(async()=>{const f=scan.fields.find(f=>f.idAttr==='react-protected'),e=scan.fieldMap.get(f.fieldId);return {before:ResumeProHighlightTest.readBackValue(e),result:await ResumeProHighlightTest.setElementValue(e,'本科'),after:ResumeProHighlightTest.readBackValue(e)};});
  assert.deepEqual(protectedResult,{before:'硕士',result:false,after:'硕士'});
  const confirm=await page.evaluate(async()=>{
   mountConfirmMonth();await new Promise(r=>setTimeout(r,100));const api=ResumeProHighlightTest,s=api.scanFillableFields(),f=s.fields.find(f=>f.idAttr==='iview-confirm'),entry=s.fieldMap.get(f.fieldId);
   return {result:await api.setElementValue(entry,'2022-02'),actual:api.readBackValue(entry),committed:window.values['iview-confirm'],confirmed:window.confirmOK,trace:entry.interactions};
  });
  assert.equal(confirm.result.ok,true,JSON.stringify(confirm));assert.equal(confirm.actual,'2022-02');assert.equal(confirm.confirmed,true);assert.equal(confirm.committed,'2022-02');
  const disabled=await page.evaluate(async()=>{
   mountDisabledMonth();await new Promise(r=>setTimeout(r,100));const api=ResumeProHighlightTest,s=api.scanFillableFields(),f=s.fields.find(f=>f.idAttr==='element-disabled'),entry=s.fieldMap.get(f.fieldId);
   return {result:await api.setElementValue(entry,'2022-02'),actual:api.readBackValue(entry)};
  });
  assert.equal(disabled.result.ok,false,JSON.stringify(disabled));assert.equal(disabled.actual,'');assert.match(disabled.result.reason,/禁用|缺失/);
  const ambiguous=await page.evaluate(async()=>{
   const widget=document.createElement('div');widget.className='ant-picker';widget.innerHTML='<input readonly placeholder="YYYY-MM" aria-controls="ambiguous-calendar">';document.body.append(widget);
   const panel=document.createElement('div');panel.id='ambiguous-calendar';panel.className='ant-picker-dropdown';panel.style.display='none';
   panel.innerHTML='<div class="ant-picker-panel"><div class="ant-picker-month-panel"><table><tr><td class="ant-picker-cell ant-picker-cell-in-view">2月</td></tr></table></div><div class="ant-picker-month-panel"><table><tr><td class="ant-picker-cell ant-picker-cell-in-view">2月</td></tr></table></div></div>';
   document.body.append(panel);const input=widget.querySelector('input');input.onclick=()=>{panel.style.display='block';};
   let selections=0;panel.onclick=()=>selections++;const result=await ResumeProHighlightTest.setElementValue({kind:'element',element:input,pickerRoot:widget,pickerType:'antd'},'2022-02');
   return {result,selections,actual:input.value};
  });
  assert.equal(ambiguous.result.ok,false);assert.match(ambiguous.result.reason,/多个日期表/);assert.equal(ambiguous.selections,0);assert.equal(ambiguous.actual,'');
  assert.equal(await page.evaluate(()=>window.untrusted),0,'all pointer actions use the production browser transport');
  assert.deepEqual(errors,[]);
  console.log('PASS: labels, selected-state proof, protected existing value, disabled dates, ambiguous calendars, 9 dates and 3 dropdowns');
 }finally{await browser?.close();fs.rmSync(tmp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
