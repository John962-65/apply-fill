// Anonymous simulated controls, not a reproduction of Vivo's private form DOM.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');const path=require('node:path');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE_PATH,headless:true,args:['--no-sandbox']});
 try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setContent('<body></body>');
 for(const file of ['ai-helpers.js','interaction-agent.js','popup-controller.js','combo-agent.js'])await page.addScriptTag({path:path.resolve(__dirname,'..',file)});
 for(const planning of [false,true]) for(const mode of ['delayed','unlinked','search','preopened-search','cascade','rerender','duplicate','discard','existing']){
  const result=await page.evaluate(async ({mode,planning})=>{
   document.body.innerHTML='<div role="listbox" id="unrelated"><div role="option">杭州</div></div><div id="field"><span class="selectedValue"></span><input placeholder="请选择"></div>';
   let wrong=0,clicks=0;document.querySelector('#unrelated').onclick=()=>wrong++;
   const mount=()=>{
    const r=document.querySelector('#field'),input=r.querySelector('input');
    input.onclick=()=>{
     clicks++;setTimeout(()=>{
      if(document.querySelector('#choices'))return;
      const panel=document.createElement('div');panel.id='choices';panel.setAttribute('role','listbox');(mode==='preopened-search'?r:document.body).append(panel);
      if(!['unlinked','preopened-search'].includes(mode))input.setAttribute('aria-controls','choices');
      const render=names=>{panel.replaceChildren(...names.map(name=>{
       const option=document.createElement('div');option.setAttribute('role','option');option.textContent=name;
       option.onclick=()=>{
        if(mode==='cascade'&&name==='浙江'){setTimeout(()=>render(['杭州']),120);return;}
        if(mode==='discard')return;
        if(mode==='rerender'){const copy=r.cloneNode(true);r.replaceWith(copy);}
        document.querySelector('#field .selectedValue').textContent=name;panel.remove();
       };return option;
      }));};
      render(['search','preopened-search'].includes(mode)?['其他']:mode==='cascade'?['浙江']:mode==='duplicate'?['杭州','杭州']:['杭州']);
      input.oninput=()=>{if(['search','preopened-search'].includes(mode))setTimeout(()=>{if(mode==='preopened-search')document.body.append(panel);render(['杭州']);},200)};
     },150);
    };
   };mount();
   if(mode==='preopened-search'){document.querySelector('#field input').click();await new Promise(resolve=>setTimeout(resolve,200));}
   if(mode==='existing')document.querySelector('.selectedValue').textContent='用户已填';
   const makeEntry=()=>({root:document.querySelector('#field'),trigger:document.querySelector('#field input')});
   const entry=makeEntry();entry.beforePanels=new Set();entry.opened=false;
   if(planning)entry.decide=async state=>({id:(state.candidates.find(c=>c.kind==='choose'&&c.label===state.levelTarget)||state.candidates.find(c=>c.kind==='open')||state.candidates.find(c=>c.kind==='search')||state.candidates.find(c=>c.kind==='stop')).id});
   const agent=ResumeProComboAgent.create({visible:n=>n.isConnected&&n.getClientRects().length>0,optionSelector:'[role="option"]',displaySelector:'.selectedValue',placeholder:v=>!v||v==='请选择',refresh:makeEntry});
   const ok=await agent.fill(entry,mode==='cascade'?'浙江 / 杭州':'杭州');
   return {ok,wrong,clicks,value:agent.read(entry),note:entry.fillNote,actions:entry.interactions.map(x=>x.action)};
  },{mode,planning});
  assert.equal(result.wrong,0,mode+' must not click unrelated menu');
  assert.equal(result.ok,!['duplicate','discard','existing'].includes(mode),mode+JSON.stringify(result));
  if(result.ok){assert.equal(result.value,'杭州');assert.ok(result.actions.includes('核对'));}
  if(['search','preopened-search'].includes(mode))assert.ok(result.actions.includes('搜索'));
  if(mode==='duplicate'&&!planning)assert.match(result.note,/多个同名/);
  if(mode==='discard'&&!planning)assert.match(result.note,/未确认选中/);
  if(mode==='existing'){assert.equal(result.clicks,0);assert.equal(result.value,'用户已填');}
  console.log('PASS',mode);
 }
 assert.deepEqual(errors,[]);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
