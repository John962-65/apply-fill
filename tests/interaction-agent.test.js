const {test}=require('node:test');const assert=require('node:assert/strict');
const agent=require('../interaction-agent');
test('only current capability ids, no injected text or code',()=>{
 assert.throws(()=>agent.validate({id:'submit'},[{id:'stop'}]));
 assert.throws(()=>agent.validate({id:'x',value:'invented'},[{id:'x'}]));
 assert.throws(()=>agent.validate({id:'x'},[{id:'x'},{id:'x'}]));
});
test('reobserves and rejects stale model decisions',async()=>{
 let epoch=0,executed=0,calls=0;
 const ok=await agent.run({observe:()=>({fingerprint:String(epoch),candidates:[{id:'write',kind:'write'}]}),decide:async()=>{if(!calls++)epoch++;return {id:'write'}},execute:async()=>executed++,verify:()=>true});
 assert.equal(ok,true);assert.equal(calls,2);assert.equal(executed,1);
});
test('stop and step limit cannot report success',async()=>{
 let executed=0;const common={observe:()=>({fingerprint:'a',candidates:[{id:'stop',kind:'stop'},{id:'wait',kind:'wait'}]}),execute:()=>executed++,verify:()=>false};
 assert.equal(await agent.run({...common,decide:()=>({id:'stop'})}),false);assert.equal(executed,0);
 assert.equal(await agent.run({...common,decide:()=>({id:'wait'}),maxSteps:2}),false);assert.equal(executed,2);
});
test('worker calls configured model and validates action before returning',async()=>{
 const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');let reply='{"id":"open"}',body;
 const ctx={AbortController,ResumeProInteractionAgent:agent,importScripts(){},fetch:async(_url,opts)=>{body=JSON.parse(opts.body);return {ok:true,json:async()=>({choices:[{message:{content:reply}}]})}}};ctx.self=ctx;
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(__dirname,'../ai-worker.js'),'utf8'),ctx);
 const msg={aiConfig:{apiUrl:'https://example.invalid',apiKey:'fixture',model:'fixture'},observation:{target:'杭州',candidates:[{id:'open',kind:'open'},{id:'stop',kind:'stop'}]}};
 const result=await ctx.handleInteractionStep(msg,new AbortController());assert.equal(result.action.id,'open');assert.equal(body.model,'fixture');
 reply='{"id":"submit"}';await assert.rejects(()=>ctx.handleInteractionStep(msg,new AbortController()),/不存在/);
});
