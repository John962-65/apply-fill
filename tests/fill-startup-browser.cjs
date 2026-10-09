// Reproduce the reported pre-AI abort with 103 fields and a real blocked trigger.
// Chrome messages and model/network are fixtures; CDP, scanning, source validation,
// the complete fill controller and final page values are production code.
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
(async()=>{
 const {performInput}=await import('../browser-input.mjs');
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH,args:['--no-sandbox']});
 try{
  for(const mode of ['covered','channel','ai-failure']){
   const page=await browser.newPage({viewport:{width:1100,height:850}}),errors=[];
   page.on('pageerror',error=>errors.push(error.message));
   let modelCalls=0,inputCalls=0;const cdp=await page.context().newCDPSession(page);
   await page.exposeFunction('realInput',async action=>{
    inputCalls++;
    if(mode==='channel'&&inputCalls===1)return {ok:false,errorCode:'input_attach',error:'无法连接浏览器输入通道'};
    try{return await performInput((method,params)=>cdp.send(method,params),action);}
    catch(error){return {ok:false,errorCode:error.code,error:error.message};}
   });
   await page.exposeFunction('workerFill',async message=>{
    modelCalls++;assert.equal(message.formFields.length,103);
    const city=message.formFields.find(f=>f.idAttr==='city'),language=message.formFields.find(f=>f.idAttr==='language');
    assert.equal(city.optionsSource,'unobserved');assert.deepEqual(city.options,[]);assert.equal(city.optionsComplete,false);
    assert.equal(language.optionsSource,'live');assert.deepEqual(language.options,['英语']);
    if(mode==='ai-failure')return {success:false,error:'接口暂不可用',diagnostics:{errorCode:'network',aiFields:103}};
    const targets={name:['匿名候选人','source-name'],email:['candidate@example.invalid','source-email'],city:['成都','source-city'],language:['英语','source-language'],note:['简历备注','source-note']};
    const proposed=message.formFields.filter(f=>targets[f.idAttr]).map(f=>({fieldId:f.fieldId,value:targets[f.idAttr][0],sourceId:targets[f.idAttr][1]}));
    const ctx={importScripts(){},ResumeProAIHelpers:require('../ai-helpers'),AbortController,TextEncoder,setTimeout,clearTimeout,performance,
     fetch:async()=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(proposed)}}]})})};ctx.self=ctx;vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(root,'ai-worker.js'),'utf8'),ctx);
    const result=await ctx.handleAiFill(message);assert.equal(result.matches.length,5,JSON.stringify(result));return result;
   });
   await page.route('https://fixture.invalid/**',request=>{
    const name=new URL(request.request().url()).pathname.slice(1),file=path.resolve(root,name);
    const asset=file.startsWith(root+path.sep)&&fs.existsSync(file)&&fs.statSync(file).isFile();
    return request.fulfill({contentType:asset&&/\.m?js$/.test(name)?'text/javascript':'text/html',body:asset?fs.readFileSync(file,'utf8'):'<!doctype html><main></main>'});
   });
   await page.goto('https://fixture.invalid/form');
   await page.evaluate(mode=>{
    self.__RESUME_PRO_TEST__=true;self.wrongClicks=0;self.untrustedClicks=0;
    document.head.insertAdjacentHTML('beforeend',`<style>
     body{font:16px sans-serif;padding:24px}.phoenix-form-item{margin:14px 0}
     .control-shell,.phoenix-select{position:relative;width:230px;height:36px}
     .phoenix-select{border:1px solid #888;box-sizing:border-box}
     .phoenix-select__content{margin:0;padding:0;list-style:none}.phoenix-select__inputWrapper{position:relative;width:12px;height:34px;overflow:hidden}
     .phoenix-select__input{width:10px;height:32px;padding:0;border:0}
     .phoenix-select__placeHolder{position:absolute;left:0;top:0;width:100%;height:100%;background:white;z-index:1}
     #cover{position:absolute;inset:0;width:100%;height:100%;z-index:5}
     .common-unmodeled-layer__layerContent{position:fixed;background:white;border:1px solid #888;z-index:8;padding:10px}
     .phoenix-single-select-list__item{padding:8px;cursor:pointer}
    </style>`);
    const combo=(id,label)=>`<div class="phoenix-form-item"><div class="phoenix-form-item-label-content">${label}</div><div class="control-shell"><div id="${id}" class="phoenix-select"></div>${id==='city'&&mode!=='channel'?'<button id="cover" type="button">网站遮罩</button>':''}</div></div>`;
    document.querySelector('main').innerHTML='<h2>基本信息</h2>'+combo('city','意向城市')+'<label>姓名<input id="name"></label><label>邮箱<input id="email" type="email"></label><label>备注<input id="note" value="人工备注"></label>'+combo('language','语言')+Array.from({length:98},(_,i)=>`<label>补充字段${i+1}<input id="extra-${i+1}"></label>`).join('');
    document.getElementById('cover')?.addEventListener('click',()=>wrongClicks++);
    function render(control,value=''){
     control.innerHTML=`<div class="phoenix-select__placeHolder">${value||'请选择'}</div><ul class="phoenix-select__content"><li class="phoenix-select__inputWrapper"><input class="phoenix-select__input phoenix-select__input--unText" placeholder="请选择"></li></ul><span class="phoenix-select__tipEle">${value}</span>`;
     control.onclick=event=>{
      if(!event.isTrusted){untrustedClicks++;return;}
      document.getElementById('choices')?.remove();const popup=document.createElement('div'),r=control.getBoundingClientRect();
      popup.id='choices';popup.className='common-unmodeled-layer__layerContent';popup.style=`left:${r.left}px;top:${r.bottom+3}px`;
      popup.innerHTML='<ul class="phoenix-single-select-list"><li class="phoenix-single-select-list__item">'+(control.id==='city'?'成都':'英语')+'</li></ul>';
      popup.querySelector('li').onclick=e=>{if(!e.isTrusted){untrustedClicks++;return;}const chosen=e.currentTarget.textContent;popup.remove();render(control,chosen);};
      document.body.append(popup);
     };
    }
    document.querySelectorAll('.phoenix-select').forEach(control=>render(control));
    document.body.addEventListener('mousedown',e=>{if(e.target===document.body)document.getElementById('choices')?.remove();});
    self.fixtureStore={templates:[{id:'t',name:'匿名简历',groups:[{id:'g',name:'基本信息',fields:[
     {id:'source-name',key:'姓名',value:'匿名候选人'},{id:'source-email',key:'邮箱',value:'candidate@example.invalid'},
     {id:'source-city',key:'意向城市',value:'成都'},{id:'source-language',key:'语言',value:'英语'},{id:'source-note',key:'备注',value:'简历备注'}
    ]}]}],activeTemplateId:'t',aiConfig:{apiUrl:'https://fixture.invalid/api',model:'fixture',apiKey:'fixture'}};
    self.chrome={runtime:{id:'fixture',getURL:p=>new URL(p,location.origin).href,getManifest:()=>({version:'test'}),sendMessage:async message=>{
     if(message.type==='BROWSER_INPUT')return realInput(message.action);
     if(message.type==='AI_FILL')return workerFill(message);
     if(message.type==='AI_INTERACTION_STEP'){const c=message.observation.candidates;return {success:true,action:{id:(c.find(x=>x.kind==='choose'&&x.label===message.observation.target)||c.find(x=>x.kind==='open')||c.find(x=>x.kind==='stop')).id}};}
     return {ready:true};
    }},storage:{local:{get:async()=>structuredClone(fixtureStore),set:async value=>Object.assign(fixtureStore,value)},onChanged:{addListener(){}}}};
    const host=document.createElement('div');host.id='resume-pro-sidebar';document.body.append(host);
   },mode);
   for(const script of JSON.parse(fs.readFileSync(path.join(root,'manifest.json'))).content_scripts[0].js){
    await page.addScriptTag({path:path.join(root,script)});
   }
   const result=await page.evaluate(async()=>{
    const api=ResumeProHighlightTest,shadow=document.getElementById('resume-pro-sidebar').attachShadow({mode:'open'});
    shadow.innerHTML='<button id="resume-pro-ai-fill">填写</button><input id="resume-pro-browser-input" type="checkbox" checked><div id="resume-pro-status"></div><details id="resume-pro-diagnostics"><textarea id="resume-pro-diagnostics-text"></textarea></details><details id="resume-pro-trace"><textarea id="resume-pro-trace-text"></textarea></details>';
    fixtureStore.templates=fixtureStore.templates.map(ResumeProTree.normalizeTemplate);
    api.setCurrentStore(fixtureStore);api.setShadowRoot(shadow);
    const before=api.scanFillableFields();const trigger=before.fieldMap.get(before.fields.find(f=>f.idAttr==='language').fieldId).trigger;
    await api.handleAiFillClick({currentTarget:shadow.querySelector('button')});
    return {status:shadow.querySelector('#resume-pro-status').textContent,diagnostic:shadow.querySelector('textarea').value,trace:shadow.querySelector('#resume-pro-trace-text').value,
     name:document.getElementById('name').value,email:document.getElementById('email').value,note:document.getElementById('note').value,
     city:document.getElementById('city').querySelector('.phoenix-select__tipEle').textContent,language:document.getElementById('language').querySelector('.phoenix-select__tipEle').textContent,
     enabled:!shadow.querySelector('button').disabled,triggerIsControl:trigger.matches('.phoenix-select'),wrongClicks,untrustedClicks,extra:[...document.querySelectorAll('[id^="extra-"]')].some(n=>n.value)};
   });
   if(mode==='ai-failure'){
    assert.equal(modelCalls,1);assert.equal(result.name,'');assert.equal(result.email,'');assert.equal(result.note,'人工备注');assert.equal(result.language,'');
    assert.match(result.diagnostic,/结果：失败；错误类别：network/);assert.match(result.diagnostic,/中断阶段：AI 匹配/);
    assert.match(result.diagnostic,/尝试 2；读到选项 1；失败 1/);assert.match(result.diagnostic,/input_target_covered/);
    assert.equal(result.enabled,true);assert.deepEqual(errors,[]);
    console.log('PASS diagnostic: model failure is identified at AI matching and keeps the earlier option-read report');
   }else{
    assert.equal(modelCalls,1);assert.equal(result.name,'匿名候选人');assert.equal(result.email,'candidate@example.invalid');assert.equal(result.note,'人工备注');assert.equal(result.language,'英语');
    assert.equal(result.city,mode==='covered'?'':'成都');assert.equal(result.triggerIsControl,true);
    assert.match(result.status,new RegExp('已填写 '+(mode==='covered'?3:4)+' 个字段'));
    assert.match(result.diagnostic,/中断阶段：无/);assert.match(result.diagnostic,/网页字段：103/);assert.match(result.diagnostic,/尝试 2；读到选项 1；失败 1/);
    assert.match(result.diagnostic,new RegExp(mode==='covered'?'input_target_covered':'input_attach'));assert.match(result.trace,/选项预读未完成/);
    assert.equal(result.wrongClicks,0);assert.equal(result.untrustedClicks,0);assert.equal(result.extra,false);assert.equal(result.enabled,true);assert.deepEqual(errors,[]);
    console.log('PASS full 103-field flow:',mode,'; AI started; other fields filled; failed option read identified; manual value retained');
   }
   await page.close();
  }
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
