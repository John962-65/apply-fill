const test=require('node:test'),assert=require('node:assert/strict');
async function setup({attachFails=false,commandFails=false,active=true,url='https://fixture.invalid/',changedDuringInput=false}={}){
 const {installBrowserInput}=await import('../browser-input.mjs');let listener;const calls=[];
 installBrowserInput({runtime:{id:'extension',onMessage:{addListener:fn=>listener=fn}},tabs:{get:async()=>({active,url})},debugger:{attach:async()=>{calls.push('attach');if(attachFails)throw Error('occupied');},detach:async()=>calls.push('detach'),sendCommand:async(_target,method,params)=>{calls.push(method);if(commandFails)throw Error('lost connection');return {result:{value:params?.expression?.startsWith('location.href.split')?!changedDuringInput:{ok:true,point:{x:10,y:10}}}};}}});
 return {calls,run:(sender={id:'extension',frameId:0,tab:{id:1},url:'https://fixture.invalid/'})=>new Promise(resolve=>listener({type:'BROWSER_INPUT',action:{kind:'click',token:'00000000-0000-0000-0000-000000000000'}},sender,resolve))};
}
test('debugger lifecycle releases only a connection this operation owns',async()=>{
 for(const options of [{},{commandFails:true},{attachFails:true}]){
  const s=await setup(options),r=await s.run();assert.equal(r.ok,!options.commandFails&&!options.attachFails);
  assert.equal(s.calls.includes('detach'),!options.attachFails);
  if(options.attachFails)assert.equal(r.errorCode,'input_attach');
  if(options.commandFails)assert.equal(r.errorCode,'input_transport');
 }
});
test('inactive sender tabs and hash changes are supported; navigation stops before input',async()=>{
 for(const options of [{active:false},{url:'https://fixture.invalid/#education'}]){
  const s=await setup(options);assert.equal((await s.run()).ok,true);assert.ok(s.calls.includes('Input.dispatchMouseEvent'));
 }
 const moved=await setup({url:'https://fixture.invalid/other'});
 assert.equal((await moved.run()).errorCode,'input_page_changed');assert.deepEqual(moved.calls,[]);
 const stale=await setup({changedDuringInput:true});
 assert.equal((await stale.run()).errorCode,'input_page_changed');assert.ok(!stale.calls.some(c=>c.startsWith('Input.')));assert.ok(stale.calls.includes('detach'));
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
 const s=await setup();const r=await s.run({id:'extension',frameId:1,tab:{id:1},url:'https://fixture.invalid/'});assert.equal(r.ok,false);assert.deepEqual(s.calls,[]);
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
