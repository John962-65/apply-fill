const test=require('node:test');
const assert=require('node:assert/strict');
const T=require('../resume-tree.js');
const S=require('../resume-schema.js');
const fresh=()=>T.normalizeTemplate({id:'fixture-schema',groups:[]});

test('秋招模板只生成空字段，不虚构经历；重复应用幂等',()=>{
 const t=fresh();const ids=S.sections.filter(s=>s.common).map(s=>s.id);
 S.addSections(t,ids);
 assert.equal(t.groups.length,ids.length);
 for(const g of t.groups){if(S.getSection(g.name).repeat)assert.equal(g.records.length,0);for(const f of g.fields)assert.equal(f.value,'');}
 const before=JSON.stringify(t);S.addSections(t,ids);assert.equal(JSON.stringify(t),before);
 assert.deepEqual(T.normalizeTemplate(t),t);
});
test('教育补齐识别同义字段，学历和学位独立；不修改旧字段、来源、待确认内容',()=>{
 const t=T.normalizeTemplate({id:'edu',groups:[{name:'教育背景',fields:[{key:'教育1学校',value:'示例大学',source:{kind:'web',host:'example.test'}},{key:'教育1开始时间',value:'2020-09'},{key:'教育1学历',value:'本科'}]}],pending:[{key:'专业',value:'待确认'}]});
 const old=structuredClone(t),r=t.groups[0].records[0];S.addMissing(t,r.id);
 assert.deepEqual(t.groups[0].fields.slice(0,3),old.groups[0].fields);assert.deepEqual(t.pending,old.pending);
 const labels=T.findRecord(t,r.id).fields.map(f=>f.label);
 assert.ok(labels.includes('学位'));assert.ok(!labels.includes('入学时间'));assert.ok(!labels.includes('学校名称'));
 const before=JSON.stringify(t);S.addMissing(t,r.id);assert.equal(JSON.stringify(t),before);
});
test('同一学校两条记录补齐互不串写；只读检查提示起止反序',()=>{
 const t=T.normalizeTemplate({id:'two',groups:[{name:'教育经历',fields:[{key:'教育1学校',value:'同一学校'},{key:'教育1入学时间',value:'2024-09'},{key:'教育1毕业时间',value:'2020-06'},{key:'教育2学校',value:'同一学校'}]}]});
 const g=t.groups[0],second=structuredClone(T.findRecord(t,g.records[1].id));
 S.addMissing(t,g.records[0].id);
 assert.deepEqual(T.findRecord(t,g.records[1].id).fields,second.fields);
 const before=JSON.stringify(t);assert.equal(S.recordIssues(S.getSection(g.name),T.findRecord(t,g.records[0].id).fields).length,1);assert.equal(JSON.stringify(t),before);
 assert.deepEqual(S.recordIssues(S.getSection(g.name),[{label:'入学时间',value:'2024'},{label:'毕业时间',value:'2024-01'}]),[]);
});
test('获奖、语言考试、证书、校园经历导入时按编号分条，保留全部原文',()=>{
 for(const [name,prefix,label] of [['获奖经历','获奖','获奖名称'],['语言考试','语言考试','考试名称'],['资格证书','证书','证书名称'],['校园经历','校园','组织名称']]) {
  const raw={id:'import',groups:[{name,fields:[{key:prefix+'1'+label,value:'第一条'},{key:prefix+'1描述',value:'原文一'},{key:prefix+'2'+label,value:'第二条'}]}]};
  const t=T.normalizeTemplate(raw),g=t.groups[0];assert.equal(g.records.length,2);assert.equal(g.fields[0].recordId,g.fields[1].recordId);assert.notEqual(g.fields[1].recordId,g.fields[2].recordId);
  assert.deepEqual(g.fields.map(({key,value})=>({key,value})),raw.groups[0].fields);assert.deepEqual(T.normalizeTemplate(t),t);
 }
});
test('混合分类不猜归属，多候选分类不合并，奖项级别/等级不混用',()=>{
 assert.equal(S.getSection('语言与证书'),null);
 const t=T.normalizeTemplate({id:'ambiguous',groups:[{name:'奖励',fields:[]},{name:'获奖经历',fields:[]}]});
 const before=JSON.stringify(t);assert.deepEqual(S.addSections(t,['awards']).skipped,['获奖经历']);assert.equal(JSON.stringify(t),before);
 const a=S.getSection('奖励');assert.equal(S.definition(a,'获奖级别').label,'奖项级别');assert.equal(S.definition(a,'获奖等级').label,'获奖等级');
});

test('在校职务别名使用校园资料结构，补齐字段保留原始任职内容',()=>{
 const t=T.normalizeTemplate({id:'campus',groups:[{name:'在校职务',fields:[{key:'社团-职位',value:'干事'},{key:'社团-描述',value:'策划活动'}]}]});
 const g=t.groups[0],original=structuredClone(g.fields);
 assert.equal(S.getSection(g.name).id,'campus');S.addMissing(t,g.records[0].id);
 assert.deepEqual(g.fields.slice(0,2),original);assert.ok(g.fields.some(f=>f.label==='组织名称'));
 assert.equal(g.fields.filter(f=>/描述/.test(f.label)).length,1,'旧描述使用已有字段，不再新增另一份描述');
});
test('同义字段重复提示核对，不新增第三份；预设字段不会跨类别套用',()=>{
 const t=T.normalizeTemplate({id:'alias',groups:[{name:'项目经历',fields:[{key:'项目1项目描述',value:'A'},{key:'项目1内容概述',value:'B'}]}]});
 const g=t.groups[0],r=g.records[0];S.addMissing(t,r.id);
 assert.equal(S.recordIssues(S.getSection(g.name),g.fields).length,1);
 assert.equal(g.fields.filter(f=>S.definition(S.getSection(g.name),f.label)?.label==='项目描述').length,2);
 assert.equal(S.addMissing(t,r.id,false,'联系人电话'),0);
});


test('真实导入归一化链路：同校不同学历、非对称字段保持各自记录',()=>{
 const H=require('../ai-helpers.js');
 const parsed=H.normalizeParsedFields([
  {group:'教育经历',key:'教育1学校名称',value:'同一大学'},
  {group:'教育经历',key:'教育1学历',value:'本科'},
  {group:'教育经历',key:'教育2学校名称',value:'同一大学'},
  {group:'教育经历',key:'教育2学历',value:'硕士'},
  {group:'教育经历',key:'教育2入学时间',value:'2024-09'},
  {group:'教育经历',key:'教育2研究方向',value:'示例研究方向'}
 ]);
 const t=T.normalizeTemplate({id:'parsed',groups:[{name:'教育经历',fields:parsed}]});
 const g=t.groups[0];assert.equal(g.records.length,2);
 const masters=g.fields.find(f=>f.value==='硕士').recordId;
 assert.equal(g.fields.find(f=>f.value==='2024-09').recordId,masters);
 assert.equal(g.fields.find(f=>f.value==='示例研究方向').recordId,masters);
 assert.notEqual(g.fields.find(f=>f.value==='本科').recordId,masters);
 assert.equal(T.findRecord(t,masters).fields.find(f=>f.value==='2024-09').label,'入学时间');
});
