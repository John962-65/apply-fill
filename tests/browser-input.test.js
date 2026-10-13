const test=require('node:test'),assert=require('node:assert/strict');

async function setup({attachFails=false,commandFails=false,active=true,tabUrl='https://fixture.invalid/',frameUrl=tabUrl,
 documentId='doc-1',senderDocumentId=documentId,lifecycle='active',pendingUrl,
 changeDocumentAfterMousePress=false}={}){
 const {installBrowserInput}=await import('../browser-input.mjs');let listener;
 const calls=[],frameCalls=[],inputEvents=[];
 const tab={active,url:tabUrl,...(pendingUrl?{pendingUrl}:{})};
 let frame={documentId,url:frameUrl,documentLifecycle:lifecycle};
 installBrowserInput({
  runtime:{id:'extension',onMessage:{addListener:fn=>listener=fn}},
  tabs:{get:async()=>({...tab})},
  webNavigation:{getFrame:async details=>{frameCalls.push(details);return {...frame};}},
  debugger:{
   attach:async()=>{calls.push('attach');if(attachFails)throw Error('occupied');},
   detach:async()=>calls.push('detach'),
   sendCommand:async(_target,method,params)=>{
    calls.push(method);
    if(commandFails)throw Error('lost connection');
    if(method.startsWith('Input.'))inputEvents.push({method,type:params?.type||''});
    if(method==='Input.dispatchMouseEvent'&&params?.type==='mousePressed'&&changeDocumentAfterMousePress)
      frame={...frame,documentId:'doc-2',url:'https://fixture.invalid/new-document'};
    return {result:{value:{ok:true,point:{x:10,y:10}}}};
   }
  }
 });
 return {
  calls,frameCalls,inputEvents,
  run:(sender={id:'extension',frameId:0,tab:{id:1},url:'https://fixture.invalid/',documentId:senderDocumentId})=>
   new Promise(resolve=>listener({type:'BROWSER_INPUT',action:{kind:'click',token:'00000000-0000-0000-0000-000000000000'}},sender,resolve))
 };
}

test('debugger lifecycle releases only a connection this operation owns',async()=>{
 for(const options of [{},{commandFails:true},{attachFails:true}]){
  const s=await setup(options),r=await s.run();assert.equal(r.ok,!options.commandFails&&!options.attachFails);
  assert.equal(s.calls.includes('detach'),!options.attachFails);
  if(options.attachFails)assert.equal(r.errorCode,'input_attach');
  if(options.commandFails)assert.equal(r.errorCode,'input_transport');
 }
});

test('same-document SPA route and hash changes are allowed, including inactive sender tabs',async()=>{
 for(const options of [
  {active:false},
  {tabUrl:'https://fixture.invalid/apply?step=education',frameUrl:'https://fixture.invalid/apply?step=education'},
  {tabUrl:'https://fixture.invalid/apply/education',frameUrl:'https://fixture.invalid/apply/education'},
  {tabUrl:'https://fixture.invalid/#education',frameUrl:'https://fixture.invalid/#education'}
 ]){
  const s=await setup(options),r=await s.run();
  assert.equal(r.ok,true,JSON.stringify({options,r}));
  assert.ok(s.calls.includes('Input.dispatchMouseEvent'));
 }
});

test('same-origin document replacement and a pending navigation are rejected before input',async()=>{
 const replaced=await setup({tabUrl:'https://fixture.invalid/apply?step=education',
  frameUrl:'https://fixture.invalid/apply?step=education',documentId:'doc-2',senderDocumentId:'doc-1'});
 const replacedResult=await replaced.run();
 assert.equal(replacedResult.errorCode,'input_page_changed');
 assert.equal(replacedResult.phase,'before-input');
 assert.deepEqual(replaced.calls,[]);

 const pending=await setup({pendingUrl:'https://fixture.invalid/apply?step=education'});
 const pendingResult=await pending.run();
 assert.equal(pendingResult.errorCode,'input_page_changed');
 assert.equal(pendingResult.phase,'before-input');
 assert.deepEqual(pending.calls,[]);
});

test('a document change during input prevents later mouse events',async()=>{
 const moved=await setup({changeDocumentAfterMousePress:true});
 const result=await moved.run();
 assert.equal(result.errorCode,'input_page_changed');
 assert.equal(result.phase,'during-input');
 assert.deepEqual(moved.inputEvents.map(event=>event.type),['mouseMoved','mousePressed'],'release must not follow a document change');
 assert.ok(moved.calls.includes('detach'));
});

test('blocked or replaced targets never dispatch a mouse press and retain their error category',async()=>{
 const {performInput}=await import('../browser-input.mjs');
 for(const code of ['input_target_covered','input_target_missing','input_target_ambiguous','input_target_disabled']){
  const calls=[];
  await assert.rejects(()=>performInput(async method=>{calls.push(method);return {result:{value:{ok:false,errorCode:code}}};},{token:'00000000-0000-0000-0000-000000000000',kind:'click'}),error=>error.code===code);
  assert.deepEqual(calls,['Runtime.evaluate']);
 }
});

test('hover replacement is rechecked before pressing and unexpected page exceptions are not exposed',async()=>{
 const {performInput}=await import('../browser-input.mjs');const calls=[];
 await assert.rejects(()=>performInput(async method=>{
  calls.push(method);return calls.length===1?{result:{value:{ok:true,point:{x:10,y:10}}}}:{result:{value:{ok:false,errorCode:'input_target_missing'}}};
 },{token:'00000000-0000-0000-0000-000000000000',kind:'click'}),error=>error.code==='input_target_missing');
 assert.deepEqual(calls,['Runtime.evaluate','Input.dispatchMouseEvent','Runtime.evaluate']);
 await assert.rejects(()=>performInput(async()=>({exceptionDetails:{text:'private page message'},result:{value:{errorCode:'private page message'}}}),{token:'00000000-0000-0000-0000-000000000000',kind:'click'}),error=>error.code==='input_observation'&&!error.message.includes('private'));
});

test('child frames cannot route coordinates to the top-level tab',async()=>{
 const s=await setup();const r=await s.run({id:'extension',frameId:1,tab:{id:1},url:'https://fixture.invalid/',documentId:'doc-1'});
 assert.equal(r.ok,false);assert.deepEqual(s.calls,[]);
});

test('key-only dismissal permits Escape and rechecks ownership of focus before dispatch',async()=>{
 const {performInput}=await import('../browser-input.mjs'),token='00000000-0000-0000-0000-000000000000';
 const rejected=[];
 for(const key of ['Enter','Tab','Delete','a'])await assert.rejects(()=>performInput(async method=>{rejected.push(method)}, {kind:'key',key,token}),e=>e.code==='input_invalid');
 assert.deepEqual(rejected,[]);
 for(const retained of [false,true]){
  const calls=[];
  const run=()=>performInput(async(method,params)=>{calls.push({method,params});return method==='Runtime.evaluate'?{result:{value:calls.length===1?{ok:true}:retained}}:{}}, {kind:'key',key:'Escape',token});
  if(retained){assert.equal((await run()).ok,true);assert.deepEqual(calls.filter(c=>c.method==='Input.dispatchKeyEvent').map(c=>[c.params.type,c.params.key]),[['keyDown','Escape'],['keyUp','Escape']]);}
  else{await assert.rejects(run,e=>e.code==='input_focus');assert.equal(calls.length,2);assert.ok(calls.every(c=>c.method==='Runtime.evaluate'));}
  assert.ok(!calls.some(c=>c.method==='Input.dispatchMouseEvent'));
 }
});

test('outside dismissal refuses a covered background before any mouse press',async()=>{
 const {performInput}=await import('../browser-input.mjs'),calls=[];
 await assert.rejects(()=>performInput(async method=>{calls.push(method);return {result:{value:{ok:false,errorCode:'input_target_covered'}}}}, {kind:'dismiss',token:'00000000-0000-0000-0000-000000000000'}),e=>e.code==='input_target_covered');
 assert.deepEqual(calls,['Runtime.evaluate']);
});
