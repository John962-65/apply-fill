const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../resume-tree.js');

const legacy = () => ({id:'resume-1',name:'求职资料',groups:[{name:'教育背景',fields:[
  {key:'教育1学校',value:'同一所大学'},{key:'教育1专业',value:'机械工程'},
  {key:'教育2学校',value:'同一所大学'},{key:'教育2专业',value:'机械电子'},
  {key:'备注',value:'保留原文'}
]}]});

test('旧模板迁移保持字段和值、幂等且区分相同学校的两段经历', () => {
 const old=legacy(), migrated=T.normalizeTemplate(old);
 assert.deepEqual(migrated.groups[0].fields.map(({key,value})=>({key,value})),old.groups[0].fields);
 assert.equal(migrated.groups[0].records.length,3);
 assert.notEqual(migrated.groups[0].fields[0].recordId,migrated.groups[0].fields[2].recordId);
 assert.deepEqual(T.normalizeTemplate(migrated),migrated);
});
test('经历移动、改名、重新归一化后固定编号不变', () => {
 const t=T.normalizeTemplate(legacy()), old=t.groups[0].fields.slice(0,2).map(f=>f.id), recordId=t.groups[0].records[0].id;
 const g=T.addGroup(t,'海外教育'); T.moveRecord(t,recordId,g.id); g.records[0].name='硕士阶段';
 const migrated=T.normalizeTemplate(t); const found=T.findRecord(migrated,recordId);
 assert.deepEqual(found.fields.map(f=>f.id),old); assert.equal(found.group.name,'海外教育');
});
test('语义化旧字段的重复后缀保持两条记录', () => {
 const t=T.normalizeTemplate({id:'t',groups:[{name:'教育背景',fields:[{key:'某大学教育经历-专业',value:'A'},{key:'某大学教育经历-专业 (2)',value:'B'}]}]});
 assert.equal(t.groups[0].records.length,2);
});
test('网页采集进入待确认，不修改已有值；重复采集不累加', () => {
 const t=T.normalizeTemplate(legacy()), before=JSON.stringify(t.groups);
 const input=[{label:'专业',group:'教育背景',value:'人工修订',recordIndex:2}];
 const source={kind:'web',host:'jobs.example',capturedAt:'2026-09-27'};
 const entries=T.collectCandidates(t,input,source); t.pending.push(...entries);
 assert.equal(t.pending.length,1); assert.equal(JSON.stringify(t.groups),before);
 assert.equal(T.collectCandidates(t,input,source).length,0);
});
test('更新必须精确选择字段所在记录，不能跨经历覆盖', () => {
 const t=T.normalizeTemplate(legacy()), g=t.groups[0];
 t.pending=T.collectCandidates(t,[{label:'专业',value:'新专业',recordIndex:2}],{kind:'web',host:'example'});
 const p=t.pending[0];
 assert.throws(()=>T.acceptProposal(t,p.id,{recordId:g.records[0].id,fieldId:g.fields[3].id}),/不存在/);
 assert.equal(g.fields[3].value,'机械电子');assert.equal(t.pending.length,1);
 T.acceptProposal(t,p.id,{recordId:g.records[1].id,fieldId:g.fields[3].id});
 assert.equal(g.fields[3].value,'新专业');assert.equal(g.fields[1].value,'机械工程');assert.equal(t.pending.length,0);
});
test('相同字段名允许分属不同记录，但禁止在同一记录重复新增', () => {
 const t=T.normalizeTemplate(legacy()),g=t.groups[0];
 T.addField(t,g.records[0].id,'开始时间','2020'); T.addField(t,g.records[1].id,'开始时间','2024');
 assert.throws(()=>T.addField(t,g.records[0].id,'开始时间','2021'),/同名/);
 assert.equal(new Set(g.fields.map(f=>f.id)).size,g.fields.length);
});
test('纯空记录和待确认内容通过 JSON 保存恢复后保留', () => {
 const t=T.normalizeTemplate({id:'empty',name:'新资料',groups:[]}),g=T.addGroup(t,'项目经历');
 const r=T.addRecord(t,g.id,'新项目');t.pending=T.collectCandidates(t,[{label:'成果',value:'新成果'}],{kind:'web',host:'example'});
 const restored=T.normalizeTemplate(JSON.parse(JSON.stringify(t)));
 assert.equal(restored.groups[0].records[0].id,r.id);assert.equal(restored.pending.length,1);
});
test('单字段归类保留编号和值，重复目标不会吞掉原字段', () => {
 const t=T.normalizeTemplate(legacy()), source=t.groups[0].fields[4], id=source.id;
 T.moveField(t,id,t.groups[0].records[0].id);
 const normalized=T.normalizeTemplate(t);assert.equal(normalized.groups[0].fields.find(f=>f.id===id).value,'保留原文');
 assert.equal(normalized.groups[0].fields.find(f=>f.id===id).recordId,t.groups[0].records[0].id);
 const duplicate=T.addField(t,t.groups[0].records[1].id,'备注','第二条');
 assert.throws(()=>T.moveField(t,duplicate.id,t.groups[0].records[0].id),/同名/);
 assert.ok(t.groups[0].fields.some(f=>f.id===duplicate.id));
});
