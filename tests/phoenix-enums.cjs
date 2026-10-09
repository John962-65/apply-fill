// Public Phoenix DOM shapes, real production scanner/controller and trusted CDP input.
// No personal resume data or signed-in recruitment site is used.
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH,args:['--no-sandbox']});
 try{
  const {performInput}=await import('../browser-input.mjs');
  for(const mode of ['normal','rerender','duplicate','late-discard']){
   const page=await browser.newPage({viewport:{width:1100,height:850}}),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   const cdp=await page.context().newCDPSession(page);
   await page.exposeFunction('realInput',a=>performInput((m,p)=>cdp.send(m,p),a));
   await page.route('https://fixture.invalid/**',r=>r.fulfill({contentType:'text/html',body:fs.readFileSync(path.join(__dirname,'fixtures/phoenix-controls.html'),'utf8')}));
   await page.goto('https://fixture.invalid/form');
   await page.evaluate(mode=>{
    self.mode=mode;self.__RESUME_PRO_TEST__=true;
    document.getElementById('award').closest('section').innerHTML='<h2>获奖经历</h2><div class="form-item--phoenix"><div class="field-label">获奖级别</div><div id="level" class="phoenix-select"></div></div><div class="form-item--phoenix"><label>奖项级别<select id="native-level"><option value="">请选择</option><option value="school">院校级</option><option>国家级</option></select></label></div>';
    const level=document.getElementById('level');level.dataset.choices=JSON.stringify(['班组级','院校级','县市级','省区级','国家级','国际级','公司']);level.dataset.list=mode==='normal'?'selectList':'single';renderControl(level);
    const language=document.getElementById('language').closest('section');
    for(const [id,label] of [['listening','听说'],['reading','读写']]){
     language.insertAdjacentHTML('beforeend',`<div class="form-item--phoenix"><div class="field-label">${label}</div><div id="${id}" class="phoenix-select"></div></div>`);
     const r=document.getElementById(id);r.dataset.choices=JSON.stringify(['入门','熟练','精通','母语']);renderControl(r);
    }
    const h=document.createElement('div');h.id='resume-pro-sidebar';document.body.append(h);
    self.chrome={runtime:{id:'fixture',getURL:()=>'',getManifest:()=>({version:'test'}),sendMessage:async m=>m.type==='BROWSER_INPUT'?realInput(m.action):{}},storage:{local:{get:async()=>({}),set:async()=>{}},onChanged:{addListener(){}}}};
   },mode);
   for(const script of JSON.parse(fs.readFileSync(path.join(__dirname,'../manifest.json'))).content_scripts[0].js)await page.addScriptTag({path:path.join(__dirname,'..',script)});
   const result=await page.evaluate(async()=>{
    const api=ResumeProHighlightTest,h=document.getElementById('resume-pro-sidebar').attachShadow({mode:'open'});h.innerHTML='<input id="resume-pro-browser-input" type="checkbox" checked>';api.setShadowRoot(h);
    const scan=api.scanFillableFields(),fields=scan.fields.filter(f=>['level','native-level','listening','reading'].includes(f.idAttr));
    const outcomes=new Map(),results={},entries={};
    for(const field of fields){
     const entry=scan.fieldMap.get(field.fieldId);entry.meta=field;
     entry.decide=async()=>{throw new Error('certain enum choices must not depend on another model call');};
     const target=field.idAttr.includes('level')?'校级':'良好';
     const ok=Boolean(await api.setElementValue(entry,target));outcomes.set(field.fieldId,{ok});entries[field.idAttr]=entry;
     results[field.idAttr]={ok,value:api.readBackValue(entry),verified:ok&&api.verifyFilledValue(entry,target,field.inputType),issue:entry.fillIssue||'',note:entry.fillNote||''};
    }
    const failedFields=fields.filter(f=>['listening','reading'].includes(f.idAttr));
    const matches=failedFields.map(f=>({fieldId:f.fieldId,value:'良好',source:'ai',relation:'exact',resumeKey:'英语-'+f.label}));
    return {results,untrusted:actions.filter(a=>!a.trusted).length,wrong:unrelatedClicks,
     hints:api.collectControlHints({fields:failedFields,fieldMap:scan.fieldMap,outcomes}),
     trace:api.formatFieldTrace({fields:failedFields,fieldMap:scan.fieldMap,matches,outcomes})};
   });
   const good=['normal','rerender'].includes(mode);
   assert.equal(result.results.level.ok,good,JSON.stringify(result));
   if(good){assert.equal(result.results.level.value,'院校级');assert.equal(result.results.level.verified,true);}
   assert.equal(result.results['native-level'].ok,true);assert.equal(result.results['native-level'].value,'院校级');assert.equal(result.results['native-level'].verified,true);
   if(mode!=='duplicate')for(const id of ['listening','reading']){
    assert.equal(result.results[id].ok,false);assert.equal(result.results[id].value,'');assert.equal(result.results[id].issue,'choice-mismatch');
    assert.match(result.results[id].note,/良好.*人工确认.*入门、熟练、精通、母语/);
   }
   assert.equal(result.wrong,0);assert.equal(result.untrusted,0);assert.deepEqual(errors,[]);
   if(mode!=='duplicate'){assert.equal(result.hints.total,0);assert.match(result.trace,/需要人工选择/);assert.match(result.trace,/入门、熟练、精通、母语/);assert.doesNotMatch(result.trace,/补驱动/);}
   console.log('PASS Phoenix enum alias and mismatch:',mode);await page.close();
  }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
