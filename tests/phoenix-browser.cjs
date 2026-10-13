// Public Phoenix DOM contract + actual scanner/controller + production CDP input transport.
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH,args:['--no-sandbox']});
 try{
  const {performInput}=await import('../browser-input.mjs');
  const scenarios=['normal','wrapped','wrapped-search','search','rerender','duplicate','discard','late-discard','wrong-end','both-ends','stuck','day','month-inner','month-confirm','month-delayed','month-discard-covered'];
  const modes=process.env.PHOENIX_TEST_MODES?process.env.PHOENIX_TEST_MODES.split(',').map(s=>s.trim()).filter(Boolean):scenarios;
  for(const mode of modes){
   const page=await browser.newPage({viewport:{width:1100,height:850}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
   const cdp=await page.context().newCDPSession(page);await page.exposeFunction('realInput',a=>performInput((m,p)=>cdp.send(m,p),a));
   await page.route('https://fixture.invalid/**',r=>r.fulfill({contentType:'text/html',body:fs.readFileSync(path.join(__dirname,'fixtures/phoenix-controls.html'),'utf8')}));
   await page.goto('https://fixture.invalid/form');
   await page.evaluate(mode=>{
    self.mode=mode;self.__RESUME_PRO_TEST__=true;
    if(mode.startsWith('wrapped')){
     document.querySelectorAll('.phoenix-select').forEach((r,i)=>{
      const layer=document.createElement('div');layer.className=i%2?'phoenix-unmodeled-layer__content':'common-unmodeled-layer__layerContent';
      // Ordinary content wrappers are not the fixed popup in this fixture's CSS.
      layer.style.cssText='position:static;padding:0;border:0;background:none';r.before(layer);layer.append(r);
     });
     document.querySelectorAll('.record').forEach((r,i)=>{
      const item=r.querySelectorAll('.form-item--phoenix')[2];
      item.insertAdjacentHTML('beforeend',`<div class="phoenix-checkbox"><span class="phoenix-checkbox__box"><input id="ongoing-${i+1}" class="phoenix-checkbox__input" type="checkbox"></span><span>至今</span></div>`);
      item.querySelector('input[type="checkbox"]').onclick=e=>{
       actions.push({kind:'checkbox',trusted:e.isTrusted});
       if(!e.isTrusted)e.preventDefault();
       else if(mode==='wrapped-search'){const copy=e.target.cloneNode(true);copy.checked=e.target.checked;e.target.replaceWith(copy);}
      };
     });
    }
    const h=document.createElement('div');h.id='resume-pro-sidebar';document.body.append(h);self.chrome={runtime:{id:'fixture',getURL:()=>'',getManifest:()=>({version:'test'}),sendMessage:async m=>m.type==='BROWSER_INPUT'?realInput(m.action):{}},storage:{local:{get:async()=>({}),set:async()=>{}},onChanged:{addListener(){}}}};
   },mode);
   for(const script of JSON.parse(fs.readFileSync(path.join(__dirname,'../manifest.json'))).content_scripts[0].js)await page.addScriptTag({path:path.join(__dirname,'..',script)});
   const result=await page.evaluate(async()=>{
    const api=ResumeProHighlightTest,h=document.getElementById('resume-pro-sidebar').attachShadow({mode:'open'});h.innerHTML='<input id="resume-pro-browser-input" type="checkbox" checked>';api.setShadowRoot(h);
    const scan=api.scanFillableFields(),metas=scan.fields;
    const choose=async id=>{const f=metas.find(f=>f.idAttr===id),entry=scan.fieldMap.get(f.fieldId);return {f,entry};};
    const language=await choose('language');
    // Exercise model-directed interaction using only observed allowed actions.
    language.entry.decide=async s=>({id:(s.candidates.find(c=>c.kind==='choose'&&c.label===s.levelTarget)||s.candidates.find(c=>c.kind==='open')||s.candidates.find(c=>c.kind==='search')||s.candidates.find(c=>c.kind==='stop')).id});
    const languageOK=await api.setElementValue(language.entry,'英语');
    const a=await choose('start-one'),b=await choose('end-one');
    const dateActionStart=actions.length;
    const first=await api.setElementValue(a.entry,mode==='day'?'2025-04-03':'2022-02');
    const second=first?await api.setElementValue(b.entry,mode==='day'?'2025-04-09':'2024-06'):false;
    const firstTransaction=structuredClone(a.entry.interactionResult),firstDateActions=actions.slice(dateActionStart);
    let manualResume=null;
    if(mode==='month-discard-covered'){
     document.getElementById('choices')?.remove();self.mode='normal';
     const resumed=api.scanFillableFields();
     const startField=resumed.fields.find(f=>f.idAttr==='start-one'),endField=resumed.fields.find(f=>f.idAttr==='end-one');
     const startEntry=resumed.fieldMap.get(startField.fieldId),endEntry=resumed.fieldMap.get(endField.fieldId);
     const retried=await api.setElementValue(startEntry,'2022-02');
     const continued=await api.setElementValue(endEntry,'2024-06');
     manualResume={retried,continued,start:api.readBackValue(startEntry),end:api.readBackValue(endEntry)};
    }
    const existing=await choose('existing'),before=actions.length,protectedResult=await api.setElementValue(existing.entry,'本科');
    const protectedClicks=actions.length-before;
    const award=await choose('award'),awardOK=['normal','wrapped','wrapped-search'].includes(mode)?await api.setElementValue(award.entry,'2021-12'):null;
    let checkbox;
    if(mode.startsWith('wrapped')){
     const {f,entry}=await choose('ongoing-1');
     const before=entry.element.value;entry.meta=f;
     const dateResult=await api.setElementValue(entry,'2026-09-01');
     const dateAgentResult=await api.fillDateWithAgent({...entry,dateLike:true},'2026-09-01',f);
     const checked=await api.setElementValue(entry,'至今');
     checkbox={label:f.label,type:f.inputType,dateLike:entry.dateLike,dateResult,dateAgentResult,unchanged:entry.element.value===before,checked,verified:api.verifyFilledValue(entry,'至今','checkbox'),peer:document.getElementById('ongoing-2').checked};
    }
    // An opened popup's search input must never become an extra form field.
    if(mode!=='month-discard-covered')await realInput({token:(()=>{const n=language.entry.trigger,t=crypto.randomUUID();n.setAttribute('data-applyfill-input',t);return t;})(),kind:'click'});
    const after=api.scanFillableFields().fields;
    let pickerCheckbox;
    if(mode==='wrapped'){
     const section=document.createElement('section');
     section.innerHTML='<h2>实习经历</h2><div class="date-range-picker"><label>起止时间</label><input id="isolated-start" placeholder="YYYY-MM"><input id="isolated-end" placeholder="YYYY-MM"><div class="phoenix-checkbox"><span class="phoenix-checkbox__box"><input type="checkbox" id="isolated-current"></span><span>至今</span></div></div><div class="common-unmodeled-layer__layerContent" style="position:static"><label>备用姓名<input id="bounded-name"></label><div class="phoenix-single-select-list"><input id="bounded-query" placeholder="请输入"></div></div>';
     document.body.append(section);
     const s=api.scanFillableFields(),f=s.fields.find(f=>f.idAttr==='isolated-current');
     pickerCheckbox={type:f.inputType,label:f.label,dateLike:s.fieldMap.get(f.fieldId).dateLike,pickerType:s.fieldMap.get(f.fieldId).pickerType||null,dates:s.fields.filter(f=>f.idAttr.startsWith('isolated-')&&f.inputType==='date-picker').length,nativeSurvived:s.fields.some(f=>f.idAttr==='bounded-name'&&f.label==='备用姓名'),popupInputs:s.fields.filter(f=>f.idAttr==='bounded-query').length};
     section.remove();
    }
    return {languageOK,first,second,awardOK,protectedResult,protectedClicks,values,unrelatedClicks,
     untrusted:actions.filter(a=>!a.trusted).length,checkbox,pickerCheckbox,
     metas:metas.map(f=>({id:f.idAttr,label:f.label,kind:f.inputType,group:f.group,record:f.recordIndex,range:f.rangeId,role:f.rangeRole})),
     after:after.map(f=>f.idAttr),readLanguage:api.readBackValue(language.entry),
     verified:first&&api.verifyFilledValue(a.entry,mode==='day'?'2025-04-03':'2022-02','combobox'),note:a.entry.fillNote,
     transaction:firstTransaction,dateActions:firstDateActions,manualResume};
   });
   const good=['normal','wrapped','wrapped-search','search','rerender','day','month-inner','month-confirm','month-delayed'].includes(mode);
   assert.equal(result.unrelatedClicks,0,mode);assert.equal(result.untrusted,0,mode);
   assert.equal(result.protectedResult,false);assert.equal(result.protectedClicks,0);
   assert.equal(result.languageOK,!['duplicate','discard','late-discard'].includes(mode),mode+JSON.stringify(result));
   assert.equal(result.first,good,mode+JSON.stringify(result));
   if(good){assert.equal(result.second,true,JSON.stringify(result));assert.equal(result.values['start-one'],mode==='day'?'2025-04-03':'2022-02');assert.equal(result.values['end-one'],mode==='day'?'2025-04-09':'2024-06');assert.equal(result.verified,true);}
   assert.equal(result.values['start-two'],undefined,'another project must stay untouched');
   if(['normal','wrapped','wrapped-search'].includes(mode)){assert.equal(result.awardOK,true);assert.equal(result.values.award,'2021-12');}
   const expectedFields=mode.startsWith('wrapped')?12:10;
   assert.equal(result.metas.length,expectedFields,JSON.stringify(result.metas));assert.equal(result.after.length,expectedFields,'popup search is not a resume field');
   if(mode.startsWith('wrapped'))assert.deepEqual(result.checkbox,{label:'至今',type:'checkbox',dateLike:false,dateResult:false,dateAgentResult:false,unchanged:true,checked:true,verified:true,peer:false});
   if(mode==='wrapped')assert.deepEqual(result.pickerCheckbox,{type:'checkbox',label:'至今',dateLike:false,pickerType:null,dates:2,nativeSurvived:true,popupInputs:0});
   for(const id of ['language','start-one','end-one','start-two','end-two','award','existing','unknown'])assert.equal(result.metas.find(f=>f.id===id).kind,'combobox');
   assert.deepEqual(result.metas.filter(f=>['start-one','end-one','start-two','end-two'].includes(f.id)).map(f=>[f.label,f.group,f.record]),[['开始时间','项目经历',1],['结束时间','项目经历',1],['开始时间','项目经历',2],['结束时间','项目经历',2]]);
   const dates=result.metas.filter(f=>['start-one','end-one','start-two','end-two'].includes(f.id));assert.deepEqual(dates.map(f=>f.role),['start','end','start','end']);assert.equal(dates[0].range,dates[1].range);assert.notEqual(dates[0].range,dates[2].range);
   if(['wrong-end','both-ends'].includes(mode))assert.match(result.note,/另一端日期被改变/);
   if(mode==='month-inner')assert.ok(result.dateActions.some(a=>a.kind==='choose')&&result.dateActions.some(a=>a.kind==='commit'));
   if(mode==='month-confirm')assert.ok(result.dateActions.some(a=>a.kind==='pending-selection')&&result.dateActions.some(a=>a.kind==='commit'));
   if(mode==='month-delayed')assert.ok(result.dateActions.some(a=>a.kind==='delayed-selection')&&result.dateActions.some(a=>a.kind==='commit'));
   if(mode==='month-discard-covered'){
    assert.equal(result.first,false);assert.equal(result.transaction.status,'BLOCKED');
    assert.equal(result.transaction.code,'OPTION_COMMIT_UNCONFIRMED');
    assert.equal(result.transaction.primaryFailure,'OPTION_COMMIT_UNCONFIRMED');
    assert.equal(result.transaction.recoveryFailure,'POPUP_CLOSE_UNCONFIRMED');
    assert.equal(result.transaction.recovery.toggleAttempted,false);
    assert.equal(result.dateActions.filter(a=>a.kind==='open').length,1,'covered Phoenix trigger must not be clicked again');
    assert.deepEqual(result.manualResume,{retried:true,continued:true,start:'2022-02',end:'2024-06'},'manual dismissal must allow the failed date and following field to continue');
   }
   assert.equal(result.metas.find(f=>f.id==='existing').label,'学历');assert.equal(result.metas.find(f=>f.id==='unknown').label,'');
   assert.deepEqual(errors,[]);console.log('PASS Phoenix DOM + trusted actions:',mode);await page.close();
  }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
