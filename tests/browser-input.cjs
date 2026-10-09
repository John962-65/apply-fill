const {chromium}=require('playwright');const assert=require('node:assert/strict');
(async()=>{
 const {performInput}=await import('../browser-input.mjs');
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE_PATH,headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage();await page.setContent('<button id="open">打开下拉</button><input id="search"><output></output>');
  await page.evaluate(()=>{
   window.trusted=[];
   document.querySelector('button').onclick=e=>{trusted.push(e.isTrusted);if(e.isTrusted)document.querySelector('output').textContent='选项已展开';};
   document.querySelector('input').oninput=e=>{trusted.push(e.isTrusted);if(!e.isTrusted)e.target.value='';};
  });
  await page.evaluate(()=>document.querySelector('button').click());assert.equal(await page.locator('output').textContent(),'');
  const cdp=await page.context().newCDPSession(page);
  const act=async(selector,text)=>{const token=require('node:crypto').randomUUID();await page.locator(selector).evaluate((el,t)=>el.setAttribute('data-applyfill-input',t),token);return performInput((m,p)=>cdp.send(m,p),{token,kind:text===undefined?'click':'fill',text});};
  await act('button');assert.equal(await page.locator('output').textContent(),'选项已展开');
  await act('input','目标大学');assert.equal(await page.locator('input').inputValue(),'目标大学');
  await act('input','目标专业');assert.equal(await page.locator('input').inputValue(),'目标专业');
  const other=await browser.newPage();await other.setContent('<input id="unrelated" value="人工内容"><button>不应点击</button>');
  await other.evaluate(()=>{window.otherEvents=0;document.addEventListener('click',()=>otherEvents++);document.addEventListener('input',()=>otherEvents++);});
  await other.bringToFront();
  await act('input','后台目标');
  assert.equal(await page.locator('input').inputValue(),'后台目标','CDP input must target its own inactive tab');
  assert.equal(await other.locator('input').inputValue(),'人工内容');assert.equal(await other.evaluate(()=>otherEvents),0);
  await other.close();
  await page.evaluate(()=>{
   const button=document.querySelector('button');button.style='width:160px;height:50px';
   const r=button.getBoundingClientRect(),badge=document.createElement('div');badge.id='badge';
   badge.style=`position:fixed;left:${r.left+r.width/2-12}px;top:${r.top+r.height/2-12}px;width:24px;height:24px;background:white;z-index:9`;
   window.badgeClicks=0;badge.onclick=()=>badgeClicks++;document.body.append(badge);
  });
  await act('button');assert.equal(await page.evaluate(()=>badgeClicks),0,'a different visible point must not click the covering badge');
  await page.evaluate(()=>{document.getElementById('badge').remove();document.querySelector('button').onmouseenter=e=>{const copy=e.currentTarget.cloneNode(true);copy.removeAttribute('data-applyfill-input');copy.textContent='已替换';e.currentTarget.replaceWith(copy);};});
  await page.mouse.move(500,500);
  await assert.rejects(()=>act('button'),error=>error.code==='input_target_missing','hover replacement must not click the replacement node');
  await page.evaluate(()=>{const overlay=document.createElement('div');overlay.style='position:fixed;inset:0;background:white;z-index:99';document.body.append(overlay);});
  await assert.rejects(()=>act('button'),error=>error.code==='input_target_covered');
  await assert.rejects(()=>performInput((m,p)=>cdp.send(m,p),{token:'invalid',kind:'click'}),/无效/);
  assert.deepEqual(await page.evaluate(()=>trusted),[false,true,true,true,true,true]);
  await page.setContent('<style>html,body{margin:0}main{min-height:100vh;background:#eee}.ud-formily-item-label{width:180px;height:40px}</style><main><div class="ud-formily-item"><div class="ud-formily-item-label"><span>性别</span></div><button id="danger">提交</button></div></main>');
  await page.evaluate(()=>{window.danger=0;window.dismissed=0;document.getElementById('danger').onclick=()=>danger++;document.querySelector('.ud-formily-item-label').onmousedown=e=>{if(e.isTrusted)dismissed++;};});
  const dismiss=async()=>{const token=require('node:crypto').randomUUID();await page.locator('.ud-formily-item-label').evaluate((el,t)=>el.setAttribute('data-applyfill-input',t),token);return performInput((m,p)=>cdp.send(m,p),{token,kind:'dismiss'});};
  await dismiss();assert.equal(await page.evaluate(()=>dismissed),1,'a trusted pointer can dismiss on an inert label in a dense layout');
  await page.evaluate(()=>document.querySelector('.ud-formily-item-label').append(document.getElementById('danger')));
  await assert.rejects(dismiss,error=>error.code==='input_target_covered','a label containing a submit control is never an outside-click surface');
  assert.equal(await page.evaluate(()=>danger),0);
  await page.evaluate(()=>{document.querySelector('.ud-formily-item-label').innerHTML='<label for="selected">学校名称</label>';const input=document.createElement('input');input.id='selected';document.querySelector('main').append(input);});
  await assert.rejects(dismiss,error=>error.code==='input_target_covered','a linked label could reopen the control and must be rejected');
  console.log('PASS: trusted input, partially covered target, hover replacement, fully blocked and invalid target');
  console.log('PASS: dense-page inert-label dismissal rejects interactive and linked labels');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
