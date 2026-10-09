const test=require('node:test');
const assert=require('node:assert/strict');
const T=require('../resume-tree.js');
async function setup() {
 const {installResumeStore}=await import('../resume-store.mjs');
 const data={templates:[T.normalizeTemplate({id:'t',name:'旧资料',groups:[]})]};let handler;
 installResumeStore({runtime:{id:'extension',getURL:p=>`chrome-extension://extension/${p}`,onMessage:{addListener:fn=>handler=fn}},storage:{local:{get:async keys=>Object.fromEntries(keys.filter(k=>k in data).map(k=>[k,structuredClone(data[k])])),set:async changes=>Object.assign(data,structuredClone(changes))}}});
 const call=(message,sender={id:'extension',url:'chrome-extension://extension/popup.html',tab:{id:1}})=>new Promise(resolve=>handler(message,sender,resolve));
 return {data,call};
}
test('同时保存同一旧版本，第二个请求被拒绝而非覆盖第一份更改',async()=>{
 const {data,call}=await setup();const expected=structuredClone(data);
 const a=structuredClone(data.templates),b=structuredClone(a);a[0].name='A';b[0].name='B';
 const result=await Promise.all([call({type:'RESUME_COMMIT',expected,changes:{templates:a}}),call({type:'RESUME_COMMIT',expected,changes:{templates:b}})]);
 assert.equal(result[0].success,true);assert.equal(result[1].success,false);assert.equal(data.templates[0].name,'A');
});
test('网页补充过滤口令、记录实际来源域名，重复请求不会重复入队',async()=>{
 const {data,call}=await setup();const sender={id:'extension',url:'https://jobs.example/form?token=private',tab:{id:9}};
 const message={type:'RESUME_COLLECT',templateId:'t',fields:[{label:'验证码',value:'1234'},{label:'技能',value:'C++'}]};
 assert.equal((await call(message,sender)).added,1);assert.equal((await call(message,sender)).added,0);
 assert.equal(data.templates[0].pending[0].source.host,'jobs.example');assert.equal(data.templates[0].groups.length,0);
});
test('网页内容脚本不能调用整份资料替换接口',async()=>{
 const {data,call}=await setup();const result=await call({type:'RESUME_COMMIT',expected:structuredClone(data),changes:{templates:[]}},{id:'extension',url:'https://jobs.example',tab:{id:9}});
 assert.equal(result.success,false);assert.equal(data.templates.length,1);
});

test('经历结构改变后清理旧位置映射，保留控件观察',async()=>{
 const {data,call}=await setup();
 data.formStructures=[{platform:'demo',fields:[{label:'学校',resumeKey:'教育1学校',drive:'native-setter'}]}];
 const expected={templates:structuredClone(data.templates)},next=structuredClone(data.templates);
 const group=T.addGroup(next[0],'教育经历');T.addRecord(next[0],group.id,'硕士');
 assert.equal((await call({type:'RESUME_COMMIT',expected,changes:{templates:next}})).success,true);
 assert.equal(data.formStructures[0].fields[0].resumeKey,'');
 assert.equal(data.formStructures[0].fields[0].drive,'native-setter');
});
test('仅修改字段值继续复用原映射',async()=>{
 const {data,call}=await setup();const g=T.addGroup(data.templates[0],'基本信息');const r=T.addRecord(data.templates[0],g.id,'本人');T.addField(data.templates[0],r.id,'姓名','张三');
 data.formStructures=[{fields:[{label:'姓名',resumeKey:g.fields[0].key}]}];
 const expected={templates:structuredClone(data.templates)},next=structuredClone(data.templates);next[0].groups[0].fields[0].value='李四';
 assert.equal((await call({type:'RESUME_COMMIT',expected,changes:{templates:next}})).success,true);
 assert.ok(data.formStructures[0].fields[0].resumeKey);
});

test('AI归纳只保存建议；返回前资料改变则拒绝旧建议',async()=>{
 const {data,call}=await setup();
 await call({type:'RESUME_COLLECT',templateId:'t',fields:[{label:'项目职责',value:'原始职责'}]},{id:'extension',url:'https://jobs.example',tab:{id:9}});
 const prepared=await call({type:'RESUME_REVIEW_CONTEXT',templateId:'t'});assert.equal(prepared.success,true);
 const p=prepared.context.pending[0];const suggestions=[{id:p.id,action:'add',groupName:'项目经历',recordName:'项目A',label:'主要工作',value:'编造值'}];
 const saved=await call({type:'RESUME_REVIEW_SUGGEST',templateId:'t',context:prepared.context,suggestions});assert.equal(saved.organized,1);
 assert.equal(data.templates[0].groups.length,0);assert.equal(data.templates[0].pending[0].value,'原始职责');assert.equal(data.templates[0].pending[0].suggestion.label,'主要工作');
 data.templates[0].pending[0].value='用户后续修改';
 const stale=await call({type:'RESUME_REVIEW_SUGGEST',templateId:'t',context:prepared.context,suggestions});assert.equal(stale.success,false);assert.match(stale.error,/已变化/);
});

test('解析核对草稿与填写资料分开暂存；过期页面不能覆盖另一页草稿',async()=>{
 const {data,call}=await setup();
 data.resumeImportDraft=null;data.activeTemplateId='t';
 const parsed=T.normalizeTemplate({id:'draft',groups:[{name:'基本信息',fields:[{key:'姓名',value:'AI 结果',source:{kind:'resume',quote:'姓名：AI 结果',verified:true},review:{status:'pending'}}]}]});
 const first=await call({type:'RESUME_COMMIT',expected:{resumeImportDraft:null},changes:{resumeImportDraft:parsed}});
 assert.equal(first.success,true);assert.equal(data.templates.length,1);assert.equal(data.activeTemplateId,'t');
 assert.equal(data.resumeImportDraft.groups[0].fields[0].review.status,'pending');
 const stale=await call({type:'RESUME_COMMIT',expected:{resumeImportDraft:null},changes:{resumeImportDraft:{...parsed,name:'旧页面'}}});
 assert.equal(stale.success,false);assert.notEqual(data.resumeImportDraft.name,'旧页面');
 const web=await call({type:'RESUME_COMMIT',expected:{resumeImportDraft:parsed},changes:{resumeImportDraft:null}},{id:'extension',url:'https://jobs.example',tab:{id:9}});
 assert.equal(web.success,false);assert.ok(data.resumeImportDraft);
});
