const {chromium}=require('playwright');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');

(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH,args:['--no-sandbox']});
  try{
    const {performInput}=await import('../browser-input.mjs');
    const page=await browser.newPage({viewport:{width:1100,height:900}}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    const cdp=await page.context().newCDPSession(page);
    await page.exposeFunction('realInput',action=>performInput((method,params)=>cdp.send(method,params),action));
    await page.route('https://fixture.invalid/**',route=>route.fulfill({
      contentType:'text/html',body:fs.readFileSync(path.join(__dirname,'fixtures/split-date-control.html'),'utf8')
    }));
    await page.goto('https://fixture.invalid/form');
    await page.evaluate(()=>{
      self.__RESUME_PRO_TEST__=true;
      const host=document.createElement('div');host.id='resume-pro-sidebar';document.body.append(host);
      self.chrome={runtime:{id:'fixture',getURL:()=>'',getManifest:()=>({version:'test'}),sendMessage:async message=>message.type==='BROWSER_INPUT'?realInput(message.action):{}},
        storage:{local:{get:async()=>({}),set:async()=>{}},onChanged:{addListener(){}}}};
    });
    for(const script of JSON.parse(fs.readFileSync(path.join(root,'manifest.json'))).content_scripts[0].js)
      await page.addScriptTag({path:path.join(root,script)});

    const result=await page.evaluate(async()=>{
      const api=ResumeProHighlightTest;
      const shadow=document.getElementById('resume-pro-sidebar').attachShadow({mode:'open'});
      shadow.innerHTML='<input id="resume-pro-browser-input" type="checkbox" checked>';
      api.setShadowRoot(shadow);
      const scan=api.scanFillableFields();
      const projectFields=scan.fields.filter(field=>field.idAttr.startsWith('e1-'));
      const filled=[];
      for(const meta of projectFields){
        const entry=api.refreshFieldEntry(meta,scan.fieldMap.get(meta.fieldId));
        entry.meta=meta;
        entry.decide=async()=>{throw new Error('年月候选存在精确匹配，无需调用 AI');};
        const value=meta.datePart==='year'?'2026':meta.rangeRole==='start'?'1':'9';
        const ok=await api.setElementValue(entry,value);
        filled.push({id:meta.idAttr,kind:entry.kind,inputType:meta.inputType,datePart:meta.datePart,rangeRole:meta.rangeRole,
          ok,verified:api.verifyFilledValue(entry,value,meta.inputType),read:api.readBackValue(entry),
          selected:entry.root?.dataset?.selected||'',note:entry.fillNote||'',interactionResult:entry.interactionResult||null,
          menuOpen:entry.root?.querySelector('[role="listbox"]')?.style.display==='block'});
      }
      const fallback=scan.fields.filter(field=>field.idAttr.startsWith('award-'));
      const rejected=[];
      for(const meta of fallback){
        const entry=api.refreshFieldEntry(meta,scan.fieldMap.get(meta.fieldId));
        entry.meta=meta;
        const value=meta.datePart==='year'?'2026':'1';
        const ok=await api.setElementValue(entry,value);
        rejected.push({id:meta.idAttr,kind:entry.kind,datePart:meta.datePart,ok,value:entry.element?.value||'',read:api.readBackValue(entry),
          verified:api.verifyFilledValue(entry,value,meta.inputType),hasExisting:api.hasExistingValue(entry),note:entry.fillNote||'',interactionResult:entry.interactionResult||null});
      }
      return {fields:projectFields.map(({datePart,rangeRole,inputType,idAttr})=>({datePart,rangeRole,inputType,idAttr})),filled,rejected,
        events:selectionEvents,collected:api.readFilledFields()};
    });

    assert.equal(result.fields.length,4,JSON.stringify(result));
    assert.deepEqual(result.fields.map(field=>[field.datePart,field.rangeRole]),[
      ['year','start'],['month','start'],['year','end'],['month','end']
    ]);
    assert.ok(result.fields.every(field=>field.inputType==='combobox'),JSON.stringify(result.fields));
    assert.ok(result.filled.every(item=>item.kind==='combobox'&&item.ok&&item.verified&&!item.menuOpen),JSON.stringify(result.filled));
    assert.deepEqual(result.filled.map(item=>item.selected),['2026','1','2026','9']);
    assert.deepEqual(result.events.filter(event=>event.kind==='option').map(event=>event.text),['2026','1','2026','9']);
    assert.ok(result.events.filter(event=>event.kind==='option').every(event=>event.trusted));
    assert.equal(result.events.some(event=>event.kind==='typed'),false,'目标值不得只作为搜索文本写入');
    assert.ok(result.rejected.every(item=>!item.ok&&item.value&&item.datePart&&!item.read&&!item.verified&&!item.hasExisting),JSON.stringify(result.rejected));
    assert.ok(result.rejected.every(item=>item.interactionResult?.code==='OPTION_COMMIT_UNCONFIRMED'),JSON.stringify(result.rejected));
    assert.equal(result.collected.some(field=>field.label==='获奖时间'),false,JSON.stringify(result.collected));
    assert.deepEqual(errors,[]);
    console.log('PASS split date routing: verified option clicks; unrecognized date parts fail closed');
    await page.close();
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
