// Generic popup transactions: no vendor CSS is required for semantic / observed portals.
const {chromium}=require('playwright'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const {performInput}=await import('../browser-input.mjs');
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH,args:['--no-sandbox']});
 try{
  for(const mode of ['semantic','classless-search','cached-opacity','stale-expanded','aria-false-open','rerender-option','two-panels','unrelated-mutation','scroll-without-commit','query-discard']){
   const page=await browser.newPage({viewport:{width:1000,height:700}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
   const cdp=await page.context().newCDPSession(page);await page.exposeFunction('realInput',a=>performInput((m,p)=>cdp.send(m,p),a));
   await page.route('https://fixture.invalid/**',r=>r.fulfill({contentType:'text/html',body:'<body></body>'}));await page.goto('https://fixture.invalid/form');
   await page.setContent('<style>body{min-height:1800px}#field{margin:30px;width:250px}input{height:30px;width:240px}ul,[role=listbox]{background:white;border:1px solid #999;padding:12px;position:absolute}li,[role=option]{cursor:pointer;padding:8px;min-width:210px}</style><div id="field"><input role="combobox" placeholder="请选择" aria-expanded="false"></div><button id="submit">提交</button>');
   for(const file of ['ai-helpers.js','control-catalog.js','interaction-agent.js','popup-controller.js','combo-agent.js'])await page.addScriptTag({path:path.resolve(__dirname,'..',file)});
   const result=await page.evaluate(async mode=>{
    let clicks=0,wrong=0,untrusted=0,replacements=0,submissions=0;
    const input=document.querySelector('#field input'),widget=document.getElementById('field');document.getElementById('submit').onclick=()=>submissions++;
    let menu;
    const makeMenu=(secondary=false)=>{
     const box=document.createElement(mode==='classless-search'?'ul':'div');
     if(mode!=='classless-search')box.setAttribute('role','listbox');
     box.id=secondary?'other':'options';const r=input.getBoundingClientRect();box.style.left=r.left+'px';box.style.top=(r.bottom+5+scrollY)+'px';
     const option=document.createElement(mode==='classless-search'?'li':'div');if(mode!=='classless-search')option.setAttribute('role','option');option.textContent='示例学校';
     const accept=e=>{
      if(!e.isTrusted){untrusted++;return;}if(secondary){wrong++;return;}clicks++;
      if(['aria-false-open','query-discard'].includes(mode)){input.setAttribute('aria-expanded','false');return;}
      if(mode==='scroll-without-commit'){scrollTo(0,1200);return;}
      input.value='示例学校';if(mode==='cached-opacity')box.style.opacity='0';else box.remove();
      if(mode!=='stale-expanded')input.setAttribute('aria-expanded','false');
     };
     option.onclick=accept;
     if(mode==='rerender-option')option.onmouseenter=()=>{if(!replacements){replacements++;const copy=option.cloneNode(true);copy.onclick=accept;option.replaceWith(copy);}};
     box.append(option);document.body.append(box);return box;
    };
    if(mode==='cached-opacity'){menu=makeMenu();menu.style.opacity='0';input.setAttribute('aria-controls','options');}
    input.onclick=()=>{
     input.setAttribute('aria-expanded','true');
     if(mode==='classless-search')return;
     if(!menu)menu=makeMenu();else menu.style.opacity='1';
     if(mode!=='two-panels')input.setAttribute('aria-controls','options');
     if(mode==='two-panels')makeMenu(true);
     if(mode==='unrelated-mutation'){
      const notice=document.createElement('div');notice.className='dropdown-open';notice.innerHTML='<button>保存</button>';notice.querySelector('button').onclick=()=>wrong++;document.body.append(notice);
     }
    };
    input.oninput=()=>{if(mode==='classless-search')setTimeout(()=>{menu=makeMenu();},180);};
    input.onkeydown=e=>{if(e.key==='Escape'&&mode!=='aria-false-open'){menu?.remove();document.getElementById('other')?.remove();input.setAttribute('aria-expanded','false');}};
    const entry={kind:'combobox',root:widget,trigger:input,structuralChoice:true,meta:{label:'学校名称'}};
    const act=async(n,action)=>{const token=crypto.randomUUID();n.setAttribute('data-applyfill-input',token);try{const r=await realInput({...action,token});if(!r.ok){const e=new Error(r.errorCode);e.code=r.errorCode;throw e;}return true;}finally{n.removeAttribute('data-applyfill-input');}};
    const agent=ResumeProComboAgent.create({visible:n=>n.isConnected&&n.getClientRects().length>0,optionSelector:'[role="option"]',displaySelector:'.selected-caption',placeholder:v=>!v||v==='请选择',refresh:()=>null,
      click:n=>act(n,{kind:'click'}),input:(n,text)=>act(n,{kind:'fill',text}),escape:n=>act(n,{kind:'key',key:'Escape'})});
    const ok=await agent.fill(entry,'示例学校');
    const final=agent.observation(entry),r={ok,read:agent.read(entry),refreshedRead:agent.read({...entry}),raw:input.value,clicks,wrong,untrusted,replacements,submissions,final,transaction:entry.interactionResult,actions:entry.interactions};agent.suspend();return r;
   },mode);
   const expected=!['two-panels','aria-false-open','scroll-without-commit','query-discard'].includes(mode);
   assert.equal(result.ok,expected,mode+' '+JSON.stringify(result));assert.equal(result.wrong,0);assert.equal(result.untrusted,0);assert.equal(result.submissions,0);assert.deepEqual(errors,[]);
   if(expected){assert.equal(result.read,'示例学校');assert.equal(result.refreshedRead,'示例学校');assert.equal(result.clicks,1);assert.equal(result.final.state,'CLOSED');assert.equal(result.final.observerActive,false);assert.equal(result.transaction.status,'SUCCESS');}
   else{assert.equal(result.read,'','query text must never be accepted as a committed selection');assert.notEqual(result.transaction.status,'SUCCESS');}
   if(mode==='classless-search')assert.ok(result.actions.some(a=>a.action==='搜索'));
   if(mode==='rerender-option')assert.equal(result.replacements,1);
   if(mode==='two-panels')assert.equal(result.clicks,0);
   if(mode==='stale-expanded')assert.ok(result.final.transitions.includes('VERIFYING>CLOSED'));
   console.log('PASS generic popup lifecycle:',mode);await page.close();
  }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
