const {chromium}=require('playwright');
const assert=require('node:assert/strict');const path=require('node:path');const fs=require('node:fs');

const statusOf=()=>document.getElementById('resume-pro-sidebar').shadowRoot.getElementById('resume-pro-capture-status').textContent;

(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined,headless:true,args:['--no-sandbox']});
 try{
  const {performInput}=await import('../browser-input.mjs');
  const css=fs.readFileSync(path.resolve(__dirname,'../content.css'),'utf8');
  const scripts=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../manifest.json'),'utf8')).content_scripts[0].js;
  const bodies={
   main:fs.readFileSync(path.resolve(__dirname,'fixtures/auto-click.html'),'utf8'),
   far:fs.readFileSync(path.resolve(__dirname,'fixtures/auto-click-far.html'),'utf8')
  };

  // 每个阶段都要一个装了真插件脚本的页面：CDP 输入走 background 那条真实传输，其余 chrome API 用替身。
  const openFixture=async(body,realInput)=>{
   const page=await browser.newPage({viewport:{width:1200,height:900}});
   const errors=[];page.on('pageerror',error=>errors.push(error.message));
   const cdp=await page.context().newCDPSession(page);
   await page.exposeFunction('realInput',action=>performInput((method,params)=>cdp.send(method,params),action));
   await page.route('https://fixture.invalid/**',route=>route.fulfill({contentType:'text/html',body}));
   await page.goto('https://fixture.invalid/form');
   await page.evaluate(css=>{
    const attach=Element.prototype.attachShadow;Element.prototype.attachShadow=function(options){return attach.call(this,{...options,mode:'open'});};
    self.__RESUME_PRO_TEST__=true;
    self.chrome={runtime:{id:'fixture',getURL:()=>'data:text/css,'+encodeURIComponent(css),getManifest:()=>({version:'test'}),sendMessage:async message=>message.type==='BROWSER_INPUT'?realInput(message.action):{}},storage:{local:{get:async()=>({templates:[],profile:{}}),set:async()=>{}},onChanged:{addListener(){}}}};
   },css);
   for(const script of scripts)await page.addScriptTag({path:path.resolve(__dirname,'..',script)});
   if(realInput)await page.evaluate(()=>{const box=document.getElementById('resume-pro-sidebar').shadowRoot.getElementById('resume-pro-browser-input');box.closest('details')?.setAttribute('open','');box.checked=true;});
   return {page,errors};
  };

  // 点侧栏按钮跑完一整轮，返回状态行文本。
  const autoDownloads=new WeakMap();
  const runAuto=async(page)=>{
   await page.locator('#resume-pro-control-capture > summary').click();
   const download=page.waitForEvent('download');
   await page.locator('#resume-pro-capture-auto').click();
   await page.waitForFunction(()=>/自动采集完成并导出/.test(document.getElementById('resume-pro-sidebar').shadowRoot.getElementById('resume-pro-capture-status').textContent),null,{timeout:120000});
   const status=await page.evaluate(statusOf);
   assert.match(status,/^未在采集/,'one click must stop capture and export the collected panels');
   autoDownloads.set(page,JSON.parse(fs.readFileSync(await (await download).path(),'utf8')));
   return status;
  };

  // 导出并解析诊断文件。
  const exportCapture=async(page)=>{
   if(autoDownloads.has(page))return autoDownloads.get(page);
   const downloadPromise=page.waitForEvent('download');
   await page.locator('#resume-pro-capture-export').click();
   return JSON.parse(fs.readFileSync(await (await downloadPromise).path(),'utf8'));
  };

  // 阶段 A：自动模式下 Escape 只是关弹层的手段，不能把整个采集会话停掉；交回手动后照常停。
  const unit=await browser.newPage();
  await unit.setContent('<div id="resume-pro-sidebar"></div><div class="atsx-select"><div class="atsx-select-selector" role="combobox" id="t">请选择</div></div>');
  await unit.evaluate(()=>{self.chrome={runtime:{getManifest:()=>({version:'test'})}};});
  await unit.addScriptTag({path:path.resolve(__dirname,'../control-capture.js')});
  const autoEscape=await unit.evaluate(()=>{
   const recorder=ResumeProControlCapture.create({});
   recorder.start();
   const escape=()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true}));
   recorder.setAuto(true);
   const armed=recorder.arm(document.getElementById('t'),{index:0,control:'combobox'});
   escape();
   const activeDuringAuto=recorder.active;
   const snapshots=JSON.parse(recorder.preview()).snapshots;
   recorder.setAuto(false);escape();
   return {armed,activeDuringAuto,reason:snapshots[0]?.reason,meta:snapshots[0]?.auto,activeAfterManualEscape:recorder.active};
  });
  assert.equal(autoEscape.armed,true);
  assert.equal(autoEscape.activeDuringAuto,true,'自动模式里派发 Escape 不该停掉采集');
  assert.equal(autoEscape.reason,'自动点击前');
  assert.deepEqual(autoEscape.meta,{index:0,control:'combobox'});
  assert.equal(autoEscape.activeAfterManualEscape,false,'交回手动模式后 Escape 仍要能停');
  await unit.close();

  // 阶段 B：填写失败清单 → 目标。用真代码挑，不在测试里复制一份规则。
  const picker=await openFixture(bodies.main,false);
  const picked=await picker.page.evaluate(()=>{
   const valued=document.createElement('input');valued.value='2020-06';document.body.append(valued);
   const entry=new Map([
    ['combo',{kind:'combobox',root:document.getElementById('combo-root'),trigger:document.getElementById('combo-trigger')}],
    // 隐藏 input 的日期控件：要点开的是外层 picker，不是那个零尺寸 input。
    ['date',{kind:'element',element:document.getElementById('date-hidden'),pickerRoot:document.getElementById('date-root'),hiddenInput:true,dateLike:true}],
    // 有可见 input 的日期控件：必须点 input，点容器正中心会落在空白处（真实站点上就这么漏掉过）。
    ['plain',{kind:'element',element:document.getElementById('plain-date-input'),pickerRoot:document.getElementById('plain-date-root'),dateLike:true}],
    ['radio',{kind:'radio',elements:[document.getElementById('danger-agree')]}],
    ['done',{kind:'element',element:document.getElementById('combo-trigger')}],
    ['unreliable',{kind:'combobox',root:document.getElementById('extra-root-1'),trigger:document.getElementById('extra-trigger-1')}],
    ['filled',{kind:'element',element:valued,pickerRoot:document.getElementById('plain-date-root'),dateLike:true}],
    ['empty',{kind:'combobox',root:document.getElementById('extra-root-2'),trigger:document.getElementById('extra-trigger-2')}]
   ]);
   const fields=[
    {fieldId:'combo',label:'学历',inputType:'select',tagName:'div'},
    {fieldId:'date',label:'开始时间',inputType:'date-picker',tagName:'input'},
    {fieldId:'plain',label:'获奖时间',inputType:'date-picker',tagName:'input'},
    {fieldId:'radio',label:'性别',inputType:'radio',tagName:'input'},
    {fieldId:'done',label:'姓名',inputType:'text',tagName:'input'},
    {fieldId:'unreliable',label:'张三',inputType:'select',tagName:'div',labelUnreliable:true},
    {fieldId:'filled',label:'毕业时间',inputType:'date-picker',tagName:'input'},
    {fieldId:'empty',label:'期望薪资',inputType:'select',tagName:'div'}
   ];
   const outcomes=new Map([
    ['combo',{ok:false,failureReason:'读回内容与预期不同'}],
    ['date',{ok:false}],
    ['plain',{ok:false}],
    ['radio',{ok:false}],
    ['done',{ok:true}],
    ['filled',{ok:true}]
   ]);
   return ResumeProHighlightTest.buildCaptureTargets({fields,fieldMap:entry,outcomes})
     .map(target=>({reason:target.reason,control:target.control,id:target.node.id,label:target.label,labelSafe:target.labelSafe,source:target.source,hint:typeof target.hint}));
  });
  assert.deepEqual(picked,[
   {reason:'读回内容与预期不同',control:'combobox',id:'combo-trigger',label:'学历',labelSafe:true,source:'fill-failure',hint:'string'},
   {reason:'write-rejected',control:'date-picker',id:'date-root',label:'开始时间',labelSafe:true,source:'fill-failure',hint:'string'},
   // 有可见 input 就点 input，和填写时 writeCalendarPanelDate 的 trigger 选择一致。
   {reason:'write-rejected',control:'date-picker',id:'plain-date-input',label:'获奖时间',labelSafe:true,source:'fill-failure',hint:'string'},
   // 标签位置上显示的是值：控件要采，标签不进导出文件。
   {reason:'label-was-value',control:'combobox',id:'extra-trigger-1',label:'',labelSafe:false,source:'fill-failure',hint:'string'},
   // 页面上已经有值的控件不采，别让它挤占点击名额；空着的自定义控件才进兜底档。
   {reason:'not-attempted',control:'combobox',id:'extra-trigger-2',label:'期望薪资',labelSafe:true,source:'fill-failure',hint:'string'}
  ],'单选会改掉用户已选的值、已填好或已有值的字段不用再采，都不该进目标清单');
  assert.deepEqual(picker.errors,[]);
  await picker.page.close();

  // 阶段 C：走真实侧栏按钮跑完整流程，两种点击方式各一遍。
  for(const mode of ['cdp','synthetic']){
   const {page,errors}=await openFixture(bodies.main,mode==='cdp');
   const status=await runAuto(page);
   assert.match(status,new RegExp(`点击 7 个，打开面板 ${mode==='cdp'?7:0} 个`),status);
   const saved=await exportCapture(page);
   const clicks=await page.evaluate(()=>({danger:self.danger,trusted:[...new Set(self.trustedClicks)].sort(),untrusted:[...new Set(self.untrustedClicks)].sort()}));

   assert.equal(saved.kind,'apply-fill/control-dom');
   assert.equal(saved.schemaVersion,1,'导出格式要给上游继续解析，不能动 schemaVersion');
   const auto=saved.autoClick;
   assert.ok(auto,`导出文件缺少 autoClick 汇总：${Object.keys(saved)}`);
   assert.equal(auto.source,'page-scan');
   assert.equal(auto.clickKind,mode);
   assert.equal(auto.targetsPlanned,7);
   assert.equal(auto.targetsClicked,7);
   assert.equal(auto.panelsOpened,mode==='cdp'?7:0,'reported open count must match real popup observations');
   const skip=kind=>auto.targetsSkipped.filter(item=>item.skip===kind);
   assert.equal(skip('denylist').length,3,JSON.stringify(auto.targetsSkipped));
   assert.equal(skip('would-modify-data').length,1,JSON.stringify(auto.targetsSkipped));
   assert.equal(skip('budget').length,3,'超出 7 个目标的部分要记成 budget，不能悄悄丢掉');
   assert.equal(skip('panel-stuck').length,0,'只认失焦关闭的面板也要能关掉，否则残留浮层会污染后面的快照');
   assert.equal(skip('offscreen').length,0);
   assert.equal(skip('session-ended').length,0,'自动模式里派发 Escape 不该把会话停掉');
   assert.deepEqual(clicks.danger,{submit:0,next:0,clear:0,consent:0},'疑似提交/跳转/清空/协议的控件一个都不能点');

   const reasons=saved.snapshots.map(snapshot=>snapshot.reason);
   for(const expected of ['自动点击前','自动点击后 350ms','自动点击后 1300ms'])assert.ok(reasons.includes(expected),expected);
   const meta=saved.snapshots.filter(snapshot=>snapshot.auto);
   assert.ok(meta.length>=21,`七个控件各三张快照，实际 ${meta.length}`);
   const beforeMeta=meta.filter(snapshot=>snapshot.reason==='自动点击前'),afterMeta=meta.filter(snapshot=>snapshot.reason!=='自动点击前');
   assert.equal(beforeMeta.length,7);
   assert.ok(beforeMeta.every(snapshot=>!Object.hasOwn(snapshot.auto,'opened')&&!Object.hasOwn(snapshot.auto,'clickKind')),'点击前的证据不能被后续打开统计回填');
   assert.deepEqual([...new Set(afterMeta.map(snapshot=>snapshot.auto.clickKind))],[mode]);
   assert.deepEqual(afterMeta.map(snapshot=>snapshot.auto.opened),Array(afterMeta.length).fill(mode==='cdp'),'点击后快照要写明这个控件的面板到底开没开');
   assert.ok(saved.snapshots.every(snapshot=>snapshot.panels.length<=1),`每个控件采完要关掉弹层：${JSON.stringify(saved.snapshots.map(snapshot=>snapshot.panels.length))}`);

   const panels=JSON.stringify(saved.snapshots.map(snapshot=>snapshot.panels));
   // 两种点击方式访问的控件必须一致，差别只在面板开不开得出来。
   const visited=['combo-root','date-root','extra-root-1','extra-root-2','extra-root-3','extra-root-4','plain-date-root'];
   assert.deepEqual(mode==='cdp'?clicks.trusted:clicks.untrusted,visited,`${mode} 模式访问的控件`);
   assert.deepEqual(mode==='cdp'?clicks.untrusted:clicks.trusted,[],`${mode} 模式不该走另一条点击路径`);
   if(mode==='cdp'){
    assert.ok(panels.includes('UNIQUE-COMBO-OPTION'),'只认真实点击的下拉面板必须采到');
    assert.ok(panels.includes('UNIQUE-DATE-YEAR'),'只认真实点击的日期面板必须采到');
    assert.ok(panels.includes('UNIQUE-PLAIN-DATE'),'点 input 才打得开的日期面板必须采到');
   }else{
    assert.ok(!/UNIQUE-COMBO-OPTION|UNIQUE-DATE-YEAR|UNIQUE-PLAIN-DATE/.test(panels),'合成点击打不开面板，要如实记录而不是假装采到');
   }
   assert.deepEqual(errors,[]);
   await page.close();
  }

  // 阶段 D：长表单里首屏之外的控件。browser-input 的坐标是 scrollIntoView 之后立刻读的，
  // 页面还在滚就会点到空处——真实采集文件里 y=5659 的获奖时间控件就是这么漏掉的。
  const far=await openFixture(bodies.far,true);
  const farStatus=await runAuto(far.page);
  assert.match(farStatus,/点击 1 个，打开面板 1 个/,`首屏之外的控件没点上：${farStatus}`);
  const farSaved=await exportCapture(far.page);
  assert.equal(farSaved.autoClick.targetsClicked,1);
  assert.equal(farSaved.autoClick.panelsOpened,1,'滚动没停稳就点，面板根本不会打开');
  assert.equal(farSaved.autoClick.targetsSkipped.length,0,JSON.stringify(farSaved.autoClick.targetsSkipped));
  assert.ok(JSON.stringify(farSaved.snapshots.map(snapshot=>snapshot.panels)).includes('UNIQUE-FAR-OPTION'));
  assert.deepEqual(await far.page.evaluate(()=>[...new Set(self.trustedClicks)]),['far-root']);
  assert.deepEqual(far.errors,[]);
  await far.page.close();

  console.log('PASS auto-click capture：目标挑选（失败清单/已有值排除/点击节点）、真实 CDP 与合成两条路径、危险控件全部跳过、面板关闭、首屏之外的控件');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
