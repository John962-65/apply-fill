const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const T=require('../resume-tree.js');
const S=require('../resume-schema.js');
const I=require('../resume-import.js');
const fact=(label,value,evidence=value)=>({label,value,evidence});
const section=(id,records)=>({id,records});
const record=(name,fields)=>({name,fields});
const parse=(sections,text,unclassified=[])=>I.normalizeExtraction({schemaVersion:1,sections,unclassified},text);

test('模型目录与编辑器使用同一份 18 类结构；全部字段清单进入提取协议',()=>{
 const schema=S.extractionSchema();assert.equal(schema.sections.length,18);
 const prompt=I.extractionPrompt();
 assert.ok(prompt.includes(JSON.stringify(schema)));
 for(const s of schema.sections)for(const f of s.fields)assert.ok(prompt.includes(f.label));
 assert.match(prompt,/人工|本人核对/);assert.match(prompt,/不补造 1 号/);
});
test('提取草稿有完整目录和空白字段，不虚构缺失经历或个人事实',()=>{
 const extraction=parse([section('basic',[record('本人',[fact('姓名','匿名候选人')])])],'姓名：匿名候选人');
 const draft=I.createDraft(extraction,{id:'draft',fileName:'resume.txt'});
 assert.deepEqual(draft.groups.map(g=>g.name),S.sections.map(s=>s.name));
 assert.equal(draft.groups.find(g=>g.name==='教育经历').records.length,0);
 const basic=draft.groups[0];assert.equal(basic.fields.length,S.sections[0].fields.length);
 assert.equal(basic.fields.find(f=>f.label==='手机号').value,'');
 assert.equal(basic.fields.find(f=>f.label==='性别').value,'');
 assert.equal(I.pendingFields(draft).length,1);
 assert.throws(()=>I.completeReview(draft),/待核对/);
 assert.deepEqual(T.normalizeTemplate(draft),draft,'引用与核对状态经过存储归一化不丢失');
});
test('同校的两个阶段与同名奖项不同年份不合并，日期精度保留原文',()=>{
 const text='本科 示例大学 2020.09—2024.06；硕士 示例大学 2024.09—2027.06；学业奖学金 2024.9.1；学业奖学金 2025.9.1';
 const extraction=parse([
  section('education',[record('示例大学 本科',[fact('学校名称','示例大学'),fact('学历','本科'),fact('入学时间','2020.09')]),record('示例大学 硕士',[fact('学校名称','示例大学'),fact('学历','硕士'),fact('入学时间','2024.09')])]),
  section('awards',[record('学业奖学金',[fact('获奖名称','学业奖学金'),fact('获奖时间','2024.9.1')]),record('学业奖学金',[fact('获奖名称','学业奖学金'),fact('获奖时间','2025.9.1')])])
 ],text);
 const draft=I.createDraft(extraction,{id:'repeat'});
 for(const groupName of ['教育经历','获奖经历']) {
  const g=draft.groups.find(g=>g.name===groupName);assert.equal(g.records.length,2);
  assert.notEqual(g.records[0].id,g.records[1].id);
  assert.equal(new Set(g.fields.map(f=>f.id)).size,g.fields.length);
 }
 const edu=draft.groups.find(g=>g.name==='教育经历');
 assert.equal(T.findRecord(draft,edu.records[1].id).fields.find(f=>f.label==='入学时间').value,'2024.09');
 const awards=draft.groups.find(g=>g.name==='获奖经历');
 assert.equal(T.findRecord(draft,awards.records[1].id).fields.find(f=>f.label==='获奖时间').value,'2025.9.1');
});
test('学历以明确学位生成待核对推导，缺失的语言能力维度继续留空',()=>{
 const text='取得学士学位；英语听说良好，阅读良好；全国大学英语六级 520 分';
 const extraction=parse([
  section('education',[record('学校',[fact('学位','学士','取得学士学位')])]),
  section('language',[record('英语',[fact('语言','英语'),fact('听说能力','良好','英语听说良好'),fact('阅读能力','良好','阅读良好')])]),
  section('exam',[record('六级',[fact('考试名称','全国大学英语六级'),fact('考试成绩','520')])])
 ],text);
 const draft=I.createDraft(extraction,{id:'dimensions'});
 const values=name=>Object.fromEntries(draft.groups.find(g=>g.name===name).fields.map(f=>[f.label,f.value]));
 assert.equal(values('教育经历').学历,'本科');assert.equal(values('教育经历').学位,'学士');assert.equal(values('语言能力').掌握程度,'');
 const inferred=draft.groups.find(g=>g.name==='教育经历').fields.find(f=>f.label==='学历');
 assert.equal(inferred.review.status,'pending');assert.equal(inferred.source.quote,'取得学士学位');
 assert.equal(inferred.source.inference.inputValue,'学士');assert.equal(inferred.source.inference.targetValue,'本科');
 assert.equal(values('语言能力').写作能力,'');assert.equal(values('语言能力').读写能力,'');
 assert.equal(values('语言能力').听说能力,'良好');
 assert.equal(values('语言考试').考试成绩,'520');
});
test('原句校验不接受伪造引用；未知分类、字段及冲突候选保留待人工归类',()=>{
 const text='姓名：张三；别名：小张；特殊说明：原文备注';
 const extraction=parse([
  section('basic',[record('本人',[fact('姓名','张三','姓名：张三'),fact('姓名','小张','别名：小张'),fact('性别','男','性别：男'),fact('自定项','原文备注','特殊说明：原文备注')])]),
  section('unknown',[record('未知',[fact('其他','原文备注','特殊说明：原文备注')])])
 ],text);
 assert.equal(extraction.sections[0].records[0].fields.find(f=>f.label==='姓名').verified,true);
 assert.equal(extraction.sections[0].records[0].fields.find(f=>f.label==='性别').verified,false);
 assert.equal(extraction.unclassified.length,3);
 const draft=I.createDraft(extraction,{id:'proof'});assert.equal(I.pendingFields(draft).length,5);
 assert.equal(draft.groups.find(g=>g.name==='待归类资料').fields.length,3);
 for(const g of draft.groups)for(const r of g.records)I.reviewRecord(draft,r.id);
 I.completeReview(draft);assert.equal(draft.importReview.status,'confirmed');
 assert.equal(I.pendingFields(draft).length,0);
});
test('旧解析响应进入核对草稿，未知信息不丢失，不伪造原句依据',()=>{
 const extraction=I.fromLegacyFields([{group:'项目经历',key:'项目1名称',value:'匿名项目'},{group:'项目经历',key:'项目1职责',value:'开发系统'},{group:'额外信息',key:'自定义字段',value:'原始内容'}],'匿名项目 开发系统');
 const draft=I.createDraft(extraction,{id:'legacy'});
 const project=draft.groups.find(g=>g.name==='项目经历');
 assert.equal(project.records.length,1);assert.equal(project.fields.find(f=>f.label==='主要职责').value,'开发系统');
 const extra=draft.groups.find(g=>g.name==='待归类资料').fields[0];assert.equal(extra.value,'原始内容');assert.equal(extra.source.verified,false);
});
test('人工归类可移入同名空白模板字段，保留候选编号及引用；非空目标拒绝覆盖',()=>{
 const raw={label:'手机号',value:'13800000000',evidence:'联系电话：13800000000'};
 const extraction=parse([section('basic',[record('本人',[fact('姓名','匿名候选人')])])],'匿名候选人；联系电话：13800000000',[raw]);
 const draft=I.createDraft(extraction,{id:'move'}),g=draft.groups.find(g=>g.name==='待归类资料');
 const source=structuredClone(g.fields[0]),basic=draft.groups[0],r=basic.records[0];
 T.moveField(draft,source.id,r.id);
 const moved=basic.fields.find(f=>f.label==='手机号');assert.equal(moved.id,source.id);assert.equal(moved.source.quote,source.source.quote);
 assert.equal(moved.review.status,'pending');assert.equal(moved.value,'13800000000');
 assert.equal(basic.fields.filter(f=>f.label==='手机号').length,1);
 const conflict=T.addField(draft,g.records[0].id,'手机号','13900000000');
 assert.throws(()=>T.moveField(draft,conflict.id,r.id),/同名/);assert.equal(moved.value,'13800000000');
});
test('生产解析请求使用固定目录，并返回引用与可编辑结构；格式错误可恢复',async()=>{
 const payload={schemaVersion:1,sections:[section('basic',[record('本人',[fact('姓名','匿名示例','姓名：匿名示例')])])],unclassified:[]};
 let body;
 const context={importScripts(){},ResumeProAIHelpers:require('../ai-helpers.js'),ResumeProImport:I,ResumeProUtils:{formatAiError:()=>''},AbortController,TextEncoder,performance,setTimeout,clearTimeout,
  fetch:async(url,opts)=>{body=JSON.parse(opts.body);return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(payload)}}]})};}};
 context.self=context;vm.createContext(context);vm.runInContext(fs.readFileSync(require.resolve('../ai-worker.js'),'utf8'),context);
 const message={content:'姓名：匿名示例',aiConfig:{apiUrl:'https://model.invalid/v1/chat/completions',model:'fixture',apiKey:'fixture-key'}};
 const result=await context.handleParseResume(message);
 assert.equal(result.success,true);assert.equal(result.extraction.sections[0].records[0].fields[0].verified,true);
 assert.equal(result.fields[0].value,'匿名示例');assert.ok(body.messages[0].content.includes(JSON.stringify(S.extractionSchema())));
 context.fetch=async()=>({ok:true,json:async()=>({choices:[{message:{content:'{"sections":[]}'}}]})});
 const empty=await context.handleParseResume(message);assert.equal(empty.success,false);assert.match(empty.error,/有效信息/);
});
