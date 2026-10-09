const {chromium}=require('playwright');
const assert=require('node:assert/strict');const path=require('node:path');const fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined,headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setContent('<div id="resume-pro-sidebar"></div><div class="atsx-date-picker atsx-date-picker-period-month"><input style="width:0;opacity:0" value="SECRET-INPUT"><span id="start">YYYY-MM</span><span>YYYY-MM</span><textarea>SECRET-TEXTAREA</textarea><div contenteditable="true"><b>SECRET-EDIT</b></div></div><div id="unrelated">SECRET-OUTSIDE</div>');
  await page.evaluate(()=>{
   self.chrome={runtime:{getManifest:()=>({version:'test'})}};
   const host=document.getElementById('resume-pro-sidebar'),shadow=host.attachShadow({mode:'open'});shadow.innerHTML='<button id="go">采集</button><button id="export">导出</button><p></p>';
   document.getElementById('start').onclick=()=>setTimeout(()=>{const p=document.createElement('div');p.className='unknown-widget-popup';p.innerHTML='<button aria-label="上一年">2025年</button><button data-date="2025-03">三月</button>';document.body.append(p);},100);
  });
  await page.addScriptTag({path:path.resolve(__dirname,'../control-catalog.js')});
  await page.addScriptTag({path:path.resolve(__dirname,'../control-capture.js')});
  await page.evaluate(()=>{
   const shadow=document.getElementById('resume-pro-sidebar').shadowRoot;
   self.capture=ResumeProControlCapture.create({onUpdate:s=>shadow.querySelector('p').textContent=s.message});
   shadow.getElementById('go').onclick=()=>capture.start();shadow.getElementById('export').onclick=()=>capture.exportFile();
  });
  await page.locator('#go').click();
  await page.locator('#unrelated').click();
  assert.equal(await page.evaluate(()=>JSON.parse(capture.preview()).snapshots.length),0);
  await page.locator('#start').click();await page.waitForTimeout(1600);
  let data=await page.evaluate(()=>capture.preview());
  assert.ok(!/SECRET-INPUT|SECRET-TEXTAREA|SECRET-EDIT|SECRET-OUTSIDE/.test(data));
  const parsed=JSON.parse(data);assert.ok(parsed.snapshots.length>=2);assert.equal(parsed.snapshots[0].reason,'点击前');
  assert.equal(parsed.snapshots[0].controlContract.id,'atsx');assert.equal(parsed.snapshots[0].controlContract.catalogVersion,2);
  assert.ok(parsed.snapshots.some(s=>s.panels.some(p=>JSON.stringify(p).includes('三月'))));
  assert.ok(parsed.snapshots.some(s=>s.panels.some(p=>JSON.stringify(p).includes('"data-date":"2025-03"'))));
  assert.ok(parsed.snapshots.some(s=>s.panels.some(p=>JSON.stringify(p).includes('"aria-label":"上一年"'))));
  assert.ok(parsed.snapshots[0].root.children.some(c=>c.tag==='input'&&c.style.opacity==='0'));
  const dl=page.waitForEvent('download');await page.locator('#export').click();const download=await dl;
  const saved=JSON.parse(fs.readFileSync(await download.path(),'utf8'));assert.equal(saved.kind,'apply-fill/control-dom');
  assert.equal(await page.evaluate(()=>capture.active),false);
  const n=saved.snapshots.length;await page.locator('#start').click();await page.waitForTimeout(400);assert.equal(await page.evaluate(()=>JSON.parse(capture.preview()).snapshots.length),n);
  await page.locator('#go').click();assert.equal(await page.evaluate(()=>JSON.parse(capture.preview()).snapshots.length),0);
  await page.locator('#start').click();await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>capture.active),false);
  await page.evaluate(()=>{for(let i=0;i<30;i++)capture.capture();});assert.equal(await page.evaluate(()=>JSON.parse(capture.preview()).snapshots.length),24);
  await page.evaluate(()=>{
   capture.stop();self.controlClicks=0;
   document.querySelector('.atsx-date-picker').remove();
   for(const [n,year] of [[1,'2024'],[2,'2026']]){
    const wrap=document.createElement('div');wrap.className='sd-Dropdown-container-1CigZ';
    wrap.innerHTML=`<label class="sd-Select-container-1Eq4x"><input id="query-${n}" value="SECRET-QUERY-${n}"><span>▾</span></label><div class="floating-a91"><div class="row-b72">${year}</div></div>`;
    wrap.onmousedown=()=>controlClicks++;document.body.append(wrap);
   }
  });
  const directDownload=page.waitForEvent('download');
  await page.evaluate(()=>capture.exportCurrent([1,2].map(n=>({node:document.getElementById('query-'+n),reason:'write-rejected',control:'combobox'}))));
  const direct=JSON.parse(fs.readFileSync(await (await directDownload).path(),'utf8'));
  assert.equal(direct.mode,'current-page-read-only');assert.equal(direct.snapshots.length,2);
  assert.equal(await page.evaluate(()=>controlClicks),0);
  assert.deepEqual(await page.locator('input[id^="query-"]').evaluateAll(nodes=>nodes.map(n=>n.value)),['SECRET-QUERY-1','SECRET-QUERY-2']);
  assert.ok(!JSON.stringify(direct).includes('SECRET-QUERY'));
  direct.snapshots.forEach((s,i)=>{
   assert.match(s.root.attrs.class,/sd-Dropdown-container/);
   assert.ok(JSON.stringify(s.root).includes('floating-a91'));
   assert.ok(JSON.stringify(s.root).includes(i?'2026':'2024'));
   assert.ok(!JSON.stringify(s.root).includes(i?'2024':'2026'),'neighbouring popup must not be assigned to this field');
  });
  await page.setContent(fs.readFileSync(path.join(__dirname,'fixtures/feishu-ud.html'),'utf8'));
  const udDownload=page.waitForEvent('download');
  await page.evaluate(()=>{
   document.getElementById('phone').value='SECRET-UD-PHONE';
   capture.exportCurrent(['gender','birth'].map(id=>({node:document.getElementById(id),control:id==='gender'?'combobox':'date-picker'})));
  });
  const ud=JSON.parse(fs.readFileSync(await (await udDownload).path(),'utf8'));
  assert.equal(ud.snapshots.length,2);assert.ok(!JSON.stringify(ud).includes('SECRET-UD-PHONE'));
  assert.match(ud.snapshots[0].root.attrs.class,/ud__select/);assert.match(ud.snapshots[1].root.attrs.class,/ud__picker/);
  assert.ok(JSON.stringify(ud.snapshots[0].fieldContext).includes('性别'),'capture must include the bounded local label');
  assert.equal(ud.snapshots[0].controlContract.id,'feishu-ud');
  assert.ok(JSON.stringify(ud.snapshots[0].root).includes('"pointerEvents":"none"'));
  const sampled=await page.evaluate(()=>{
   const range=document.getElementById('start'),choice=document.getElementById('gender');
   const targets=[...Array.from({length:19},()=>({node:range,control:'date-picker',label:'开始时间',labelSafe:true})),{node:choice,control:'combobox',label:'性别',labelSafe:true}];
   return ResumeProControlCatalog.sampleTargets(targets,7).map(t=>t.control);
  });
  assert.equal(sampled[1],'combobox','many repeated dates must not crowd out a different widget family');
  const ui=await browser.newPage();ui.on('pageerror',e=>errors.push(e.message));
  await ui.setContent('<label>日期<input id="date" placeholder="YYYY-MM"></label>');
  await ui.evaluate(css=>{
   const attach=Element.prototype.attachShadow;Element.prototype.attachShadow=function(options){return attach.call(this,{...options,mode:'open'});};
   self.chrome={runtime:{id:'fixture',getManifest:()=>({version:'0.8.2'}),getURL:()=> 'data:text/css,'+encodeURIComponent(css),sendMessage:async()=>({})},storage:{local:{get:async()=>({templates:[],profile:{}}),set:async()=>{}},onChanged:{addListener(){}}}};
  },fs.readFileSync(path.resolve(__dirname,'../content.css'),'utf8'));
  for(const script of JSON.parse(fs.readFileSync(path.resolve(__dirname,'../manifest.json'),'utf8')).content_scripts[0].js)await ui.addScriptTag({path:path.resolve(__dirname,'..',script)});
  await ui.locator('#resume-pro-control-capture > summary').click();
  await ui.locator('#resume-pro-capture-start').click();await ui.locator('#date').click();
  await ui.locator('#resume-pro-capture-now').click();
  assert.match(await ui.locator('#resume-pro-capture-status').textContent(),/采集中/);
  const uiDownload=ui.waitForEvent('download');await ui.locator('#resume-pro-capture-export').click();await uiDownload;
  assert.match(await ui.locator('#resume-pro-capture-status').textContent(),/未在采集/);
  await ui.evaluate(()=>{
   const wrap=document.createElement('div');wrap.className='sd-Dropdown-container-1CigZ';wrap.innerHTML='<label class="sd-Select-container-1Eq4x"><input placeholder="年"></label><div class="floating-a91"><div>2024</div></div>';document.body.append(wrap);
  });
  const currentDownload=ui.waitForEvent('download');await ui.locator('#resume-pro-capture-current').click();await currentDownload;
  assert.match(await ui.locator('#resume-pro-capture-status').textContent(),/未点击或修改/);
  assert.deepEqual(errors,[]);console.log('PASS: selected control, hidden input, async popup, redaction, JSON download, stop/reset/Escape and snapshot limit');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
