const test=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');
const A=require('../collection-ai');const T=require('../resume-tree');
function fixture(){const t=T.normalizeTemplate({id:'t',groups:[{name:'教育经历',fields:[{key:'学校1',value:'同一大学'},{key:'专业1',value:'机械'},{key:'学校2',value:'同一大学'},{key:'专业2',value:'计算机'}]}]});t.pending=T.collectCandidates(t,[{label:'研究方向',value:'机器人规划',group:'教育经历',recordIndex:1}],{host:'jobs.example',kind:'web'});return t;}
test('AI建议只增加元数据；伪造目标/多条相同id/未知id无法成为确定归属',()=>{
 const t=fixture(),ctx=A.buildContext(t),p=ctx.pending[0],original=JSON.stringify(t);
 assert.deepEqual(A.validateSuggestions(ctx,[{id:'invented',action:'add'}]),[]);
 assert.deepEqual(A.validateSuggestions(ctx,[{id:p.id},{id:p.id}]),[]);
 const invalid=A.validateSuggestions(ctx,[{id:p.id,action:'update',recordId:'fake',fieldId:'fake',value:'模型捏造'}]);
 assert.equal(invalid[0].suggestion.action,'uncertain');assert.equal(invalid[0].suggestion.recordId,'');assert.equal(JSON.stringify(t),original);
 const record=ctx.records[0];const suggestion=A.validateSuggestions(ctx,[{id:p.id,action:'duplicate',recordId:record.recordId,fieldId:record.fields[0].fieldId}])[0].suggestion;
 assert.equal(suggestion.action,'update','不同值不能标记为重复');
});
test('跨记录字段编号被拒绝；事实字段不生成摘要；归纳原文保留',()=>{
 const t=fixture(),ctx=A.buildContext(t),p=ctx.pending[0];
 const bad=A.validateSuggestions(ctx,[{id:p.id,action:'update',recordId:ctx.records[0].recordId,fieldId:ctx.records[1].fields[0].fieldId}]);assert.equal(bad[0].suggestion.action,'uncertain');
 p.key='手机号码';p.value='13800000000';assert.equal(A.validateSuggestions(ctx,[{id:p.id,summary:'另一个号码'}])[0].suggestion.summary,'');
 t.pending[0].suggestion={action:'add',recordId:ctx.records[0].recordId,label:'科研方向',summary:'AI摘要'};
 const restored=T.normalizeTemplate(JSON.parse(JSON.stringify(t)));assert.equal(restored.pending[0].suggestion.label,'科研方向');
 const f=T.acceptProposal(restored,restored.pending[0].id,{recordId:ctx.records[0].recordId,label:'科研方向'});assert.equal(f.value,'机器人规划');
});
test('归纳上下文剔除密钥且分批不丢原始内容',async()=>{
 const secret=await import('../link/secret-fields.mjs');const t=fixture();const g=T.addGroup(t,'API Keys');const r=T.addRecord(t,g.id,'密钥');T.addField(t,r.id,'备注','sk-'+ 'a'.repeat(30));
 for(let i=0;i<60;i++)t.pending.push({id:'p'+i,key:'字段'+i,value:'内容',source:{host:'jobs.example'},group:'补充'});
 t.pending.push({id:'secret',key:'验证码',value:'1234'});
 t.pending[0].suggestion={action:'uncertain'};
 const context=A.buildContext(t,undefined,secret);assert.equal(context.pending.length,50);assert.ok(!JSON.stringify(context).includes('sk-'));assert.ok(!context.pending.some(p=>p.id==='secret'));
 assert.equal(t.pending.length,62);assert.deepEqual(A.buildContext(t,context.pending.map(p=>p.id),secret),context);
});
test('实际worker请求使用归纳任务；错误响应不会产出可用建议',async()=>{
 const context=A.buildContext(fixture());let body;
 const ctx={importScripts(){},ResumeProCollectionAI:A,AbortController,setTimeout,clearTimeout,fetch:async(url,options)=>{body=JSON.parse(options.body);return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify([{id:context.pending[0].id,action:'uncertain',reason:'同校经历无法区分'}])}}]})};}};ctx.self=ctx;vm.createContext(ctx);vm.runInContext(fs.readFileSync(require.resolve('../ai-worker.js'),'utf8'),ctx);
 const request={context,aiConfig:{apiUrl:'https://model.invalid/v1/chat/completions',apiKey:'fixture',model:'fixture'}};
 const result=await ctx.handleOrganizeCollection(request,new AbortController());assert.equal(result.success,true);assert.match(body.messages[0].content,/不得编造/);assert.deepEqual(JSON.parse(body.messages[1].content),context);
 ctx.fetch=async()=>({ok:false,status:503});await assert.rejects(ctx.handleOrganizeCollection(request,new AbortController()),/503/);
});

test('归纳超过一分钟仍继续等待，显式停止才取消；中断显示中文',async()=>{
 const context=A.buildContext(fixture());let finish;const timers=[];
 const ctx={importScripts(){},ResumeProCollectionAI:A,AbortController,
  setTimeout(fn,ms){timers.push({fn,ms});return timers.length;},clearTimeout(){},
  fetch:()=>new Promise(resolve=>{finish=resolve;})};ctx.self=ctx;vm.createContext(ctx);vm.runInContext(fs.readFileSync(require.resolve('../ai-worker.js'),'utf8'),ctx);
 const request={context,aiConfig:{apiUrl:'https://model.invalid/v1/chat/completions',apiKey:'fixture',model:'fixture'}};
 const controller=new AbortController();const pending=ctx.handleOrganizeCollection(request,controller);
 // Advance the worker's fake clock past two minutes, without waiting in the test.
 timers.filter(t=>t.ms<=120000).forEach(t=>t.fn());assert.equal(controller.signal.aborted,false);
 finish({ok:true,json:async()=>({choices:[{message:{content:'[]'}}]})});assert.equal((await pending).success,true);
 ctx.fetch=async()=>{const error=new Error('The user aborted a request.');error.name='AbortError';throw error;};
 await assert.rejects(ctx.handleOrganizeCollection(request,new AbortController()),/连接被中断/);
 const stopped=new AbortController();stopped.abort();await assert.rejects(ctx.handleOrganizeCollection(request,stopped),/已停止 AI 归纳/);
});

test('停止等待立即返回；迟到的模型响应不再写入建议，且通知取消接口',async()=>{
 const context=A.buildContext(fixture());let finish,cancelled=0,saved=0;
 const ctx={crypto:globalThis.crypto,Date,setInterval,clearInterval,
  chrome:{storage:{local:{get:async()=>({aiConfig:{apiUrl:'fixture',apiKey:'fixture',model:'fixture'}})}},runtime:{sendMessage:async m=>{
   if(m.type==='RESUME_REVIEW_CONTEXT')return {success:true,context};
   if(m.type==='RESUME_REVIEW_SUGGEST'){saved++;return {success:true};}
  }}},ResumeProAIClient:{send:()=>new Promise(resolve=>finish=resolve),cancel:async()=>{cancelled++;return {cancelled:true};}}};ctx.self=ctx;
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(require.resolve('../collection-ai.js'),'utf8'),ctx);
 const controller=new AbortController();let progress=-1;
 const request=ctx.ResumeProCollectionAI.organize('t',undefined,{signal:controller.signal,onProgress:n=>progress=n});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(progress,0);controller.abort();await assert.rejects(request,/已停止等待/);
 finish({success:true,suggestions:[]});await new Promise(resolve=>setImmediate(resolve));assert.equal(saved,0);assert.equal(cancelled,1);
});
