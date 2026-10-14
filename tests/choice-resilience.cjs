// Anonymous state machines exercise the production CDP channel, not a private ATS.
const {chromium}=require('playwright'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const {performInput}=await import('../browser-input.mjs');
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH,args:['--no-sandbox']});
 const modes=process.env.CHOICE_MODES?.split(',')||['classless','lazy','loading-stale','old-loading','local','search-readonly','virtual','cascade','cascade-region','cascade-stale','multi','blur-rollback','ai-alias','ai-stale','two-panels','unrelated','modal','shadow','synthetic'];
 try{for(const mode of modes){
  const page=await browser.newPage({viewport:{width:1100,height:800}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const cdp=await page.context().newCDPSession(page);await page.exposeFunction('realInput',async a=>{try{return await performInput((m,p)=>cdp.send(m,p),a);}catch(e){return {ok:false,errorCode:e.code};}});
  await page.route('https://fixture.invalid/**',r=>r.fulfill({contentType:'text/html',body:'<body></body>'}));await page.goto('https://fixture.invalid/form');
  for(const file of ['ai-helpers.js','control-catalog.js','interaction-agent.js','popup-controller.js','combo-agent.js'])await page.addScriptTag({path:path.resolve(__dirname,'..',file)});
  const result=await page.evaluate(async mode=>{
   const style='body{margin:0;padding:30px}#field{width:240px}input{height:28px;width:220px}#menu,#other{position:absolute;z-index:20;background:white;border:1px solid #999;width:230px}.row{height:30px;box-sizing:border-box;padding:5px}.column{width:230px;display:inline-block;vertical-align:top}.caption{display:block}';
   document.body.innerHTML='<style>'+style+'</style><div id="host"></div>';
   let scope=document,host=document.getElementById('host');
   if(mode==='shadow'){scope=host.attachShadow({mode:'open'});scope.innerHTML='<style>'+style+'</style>';}
   const mount=scope===document?host:scope;
   let wrapper=document.createElement('div');
   if(mode==='modal'){wrapper.setAttribute('role','dialog');wrapper.setAttribute('aria-modal','true');}
   wrapper.innerHTML='<div id="field"><input readonly placeholder="请选择"><span class="caption"></span></div>';mount.append(wrapper);
   const widget=wrapper.querySelector('#field'),input=widget.querySelector('input'),caption=widget.querySelector('.caption');
   let menu,clicks=0,wrong=0,calls=0,scrolls=0,blurred=0,trusted=0,eventOrder=[];
   const commit=(text,event)=>{clicks++;if(mode!=='synthetic'&&!event.isTrusted){wrong++;return;}if(event.isTrusted)trusted++;
    input.value=text;caption.textContent=text;
    if(mode==='blur-rollback'){menu.style.opacity='0';setTimeout(()=>menu.remove(),350);}else menu.remove();
   };
   const row=(text,accept=commit)=>{const n=document.createElement('div');n.className='row';n.innerHTML='<span></span>';n.firstChild.textContent=text;
    n.onclick=e=>accept(text,e);return n;};
   const makeMenu=(id='menu')=>{
    const p=document.createElement('div');p.id=id;
    const box=input.getBoundingClientRect();p.style.left=(box.left+(id==='other'?(mode==='unrelated'?750:10):0))+'px';p.style.top=(box.bottom+4)+'px';
    (mode==='local'?widget:mode==='modal'?wrapper:mount).append(p);if(mode==='local')p.style.position='static';return p;
   };
   const old=mode==='old-loading'?makeMenu('other'):null;if(old)old.style.cssText+=';height:0;border:0;overflow:visible';
   input.onclick=()=>{
    if(menu?.isConnected)return;
    menu=makeMenu();
    if(['lazy','classless'].includes(mode)){
     menu.setAttribute('aria-busy','true');menu.textContent='加载中';
     setTimeout(()=>{menu.removeAttribute('aria-busy');menu.replaceChildren(row('其他'),row('目标'));},mode==='lazy'?2100:150);
    }else if(mode==='loading-stale'){
     menu.setAttribute('role','listbox');menu.setAttribute('aria-busy','true');menu.replaceChildren(row('目标',()=>wrong++),row('旧选项',()=>wrong++));
     setTimeout(()=>{menu.removeAttribute('aria-busy');menu.replaceChildren(row('其他'),row('目标'));},2100);
    }else if(mode==='search-readonly'){
     input.readOnly=false;menu.replaceChildren(row('其他'),row('备用'));
     input.oninput=e=>{if(!e.isTrusted)wrong++;menu.setAttribute('aria-busy','true');setTimeout(()=>{menu.removeAttribute('aria-busy');menu.replaceChildren(row('目标'),row('别的'));},350);};
    }else if(mode==='virtual'){
     menu.style.height='120px';menu.style.overflowY='auto';
     const spacer=document.createElement('div');spacer.style.height='1800px';spacer.style.position='relative';menu.append(spacer);
     const draw=()=>{const first=Math.floor(menu.scrollTop/30);spacer.replaceChildren();for(let i=first;i<Math.min(60,first+5);i++){
      const n=row('选项'+i);n.style.position='absolute';n.style.top=(i*30)+'px';n.style.width='230px';spacer.append(n);
     }};menu.onscroll=()=>{scrolls++;draw();};draw();
    }else if(mode.startsWith('cascade')){
     menu.style.width='460px';const left=document.createElement('div'),right=document.createElement('div');left.className=right.className='column';
     left.append(row(mode==='cascade-region'?'浙江省':'浙江',(text,e)=>{clicks++;if(mode==='cascade-stale')return;e.currentTarget.setAttribute('aria-selected','true');setTimeout(()=>right.replaceChildren(row(mode==='cascade-region'?'杭州市':'杭州'),row('宁波')),240);}),row('江苏'));
     right.append(row('旧城市'),row('旧区域'));menu.append(left,right);
    }else if(mode==='multi'){
     menu.setAttribute('role','listbox');menu.setAttribute('aria-multiselectable','true');
     for(const text of ['甲','乙','丙']){const n=row(text,()=>{});n.setAttribute('role','option');const box=document.createElement('input');box.type='checkbox';box.style.width='15px';n.prepend(box);
      n.onclick=e=>{clicks++;box.checked=!box.checked;n.setAttribute('aria-selected',String(box.checked));caption.textContent=Array.from(menu.querySelectorAll('[aria-selected="true"]')).map(x=>x.textContent).join(' / ');};menu.append(n);}
    }else if(mode.startsWith('ai-'))menu.replaceChildren(row('计算机科学与技术'),row('机械工程'));
    else{
     menu.replaceChildren(row('其他'),row('目标'));
     if(old)setTimeout(()=>{old.style.height='auto';old.replaceChildren(row('目标',()=>wrong++),row('别的',()=>wrong++));},250);
     if(['two-panels','unrelated'].includes(mode)){const other=makeMenu('other');other.replaceChildren(row('目标',()=>wrong++),row('别的',()=>wrong++));}
    }
   };
   input.onblur=()=>{if(caption.textContent){blurred++;if(mode==='blur-rollback'){input.value='';caption.textContent='';}}};
   (scope===document?document:scope).addEventListener('keydown',e=>{if(e.key==='Escape'){menu?.remove();scope.querySelector('#other')?.remove();}});
   if(mode==='synthetic')for(const event of ['pointerover','mouseover','pointerdown','mousedown','pointerup','mouseup','click'])mount.addEventListener(event,e=>{if(e.target.closest('.row'))eventOrder.push(event);});
   const entry={kind:'combobox',root:widget,trigger:input,structuralChoice:mode==='search-readonly',meta:{label:mode==='cascade-region'?'工作城市':'测试选项'}};
   if(mode.startsWith('ai-'))entry.decide=async observation=>{calls++;if(mode==='ai-stale'){menu.replaceChildren(row('机械工程'),row('计算机科学与技术'));await new Promise(r=>setTimeout(r,160));}
    return {id:observation.options.find(o=>o.text==='计算机科学与技术').id};};
   const act=async(n,action)=>{const token=crypto.randomUUID();n.setAttribute('data-applyfill-input',token);try{const reply=await realInput({...action,token});if(!reply.ok){const error=new Error(reply.errorCode);error.code=reply.errorCode;throw error;}return true;}finally{n.removeAttribute('data-applyfill-input');}};
   const agent=ResumeProComboAgent.create({visible:n=>n.isConnected&&n.getClientRects().length>0,optionSelector:'[role="option"]',displaySelector:'.caption',placeholder:v=>!v||v==='请选择',refresh:()=>null,
    ...(mode==='synthetic'?{}:{click:n=>act(n,{kind:'click'}),input:(n,text)=>act(n,{kind:'fill',text}),escape:n=>act(n,{kind:'key',key:'Escape'})})});
   const ready=await agent.prepare(entry);
   const target=mode==='virtual'?'选项49':mode.startsWith('cascade')?'浙江 / 杭州':mode==='multi'?'甲 / 乙':mode.startsWith('ai-')?'CS':'目标';
   const ok=await agent.fill(entry,target),result={ok,ready,read:agent.read(entry),clicks,wrong,calls,scrolls,blurred,trusted,eventOrder,transaction:entry.interactionResult,trace:entry.interactions};agent.suspend();return result;
  },mode);
  const good=!['cascade-stale','ai-stale','two-panels'].includes(mode);
  assert.equal(result.ok,good,mode+' '+JSON.stringify(result));assert.equal(result.wrong,0,mode);assert.deepEqual(errors,[],mode);
  if(mode==='virtual'){assert.equal(result.read,'选项49');assert.ok(result.scrolls>5);assert.equal(result.clicks,1);}
  if(mode==='blur-rollback')assert.equal(result.blurred,0,'commit must not be undone by forced blur');
  if(mode==='multi')assert.equal(result.read,'甲 / 乙');
  if(mode.startsWith('ai-'))assert.equal(result.calls,1,'one bounded option decision only');
  if(mode==='ai-stale')assert.equal(result.clicks,0,'stale option index must not click a different item');
  if(mode==='two-panels')assert.equal(result.clicks,0,'two newly appeared unowned lists remain ambiguous');
  if(mode==='cascade-stale')assert.equal(result.clicks,1,'no child click without evidence of corresponding column update');
  if(mode==='modal')assert.equal(result.ready.status,'SUCCESS');
  if(mode==='synthetic')assert.deepEqual(result.eventOrder.slice(-7),['pointerover','mouseover','pointerdown','mousedown','pointerup','mouseup','click']);
  console.log('PASS choice resilience:',mode);await page.close();
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
