const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const ai = require('../ai-helpers');
const mapping = require('../form-structure');
const worker = { importScripts(){}, ResumeProAIHelpers:ai, chrome:{runtime:{onMessage:{addListener(){}}}}, AbortController, TextEncoder, performance, setTimeout, clearTimeout };
worker.self = worker;
vm.createContext(worker);
vm.runInContext(fs.readFileSync(require.resolve('../ai-worker.js'),'utf8'),worker);
test('生日不接受毕业日期；多个生日候选不猜测',()=>{
 const fields=[{fieldId:'birth',label:'出生日期',inputType:'date'}];
 assert.equal(ai.buildRuleBasedMatches(fields,[{key:'毕业日期',value:'2027-06-01'}]).length,0);
 assert.equal(ai.buildRuleBasedMatches(fields,[{key:'生日',value:'2000-01-01'},{key:'出生日期',value:'2001-01-01'}]).length,0);
 assert.equal(worker.plausibleContactSource({fieldId:'birth',value:'2027-06-01'},fields,[{key:'毕业日期',value:'2027-06-01'}]),false);
});
test('AI联系方式必须具有唯一且用途正确的来源',()=>{
 const f=[{fieldId:'phone',label:'手机号码',inputType:'text'}];
 const check=r=>worker.plausibleContactSource({fieldId:'phone',value:'13800000000'},f,r);
 assert.equal(check([]),false);
 assert.equal(check([{key:'QQ',value:'13800000000'}]),false);
 assert.equal(check([{key:'手机',value:'13800000000'}]),true);
 assert.equal(check([{key:'手机',value:'13800000000'},{key:'手机',value:'13800000000'}]),false);
 assert.equal(check([{group:'紧急联系人',key:'手机',value:'13800000000'}]),false);
 for(const [label,value] of [['邮箱','madeup@example.com'],['身份证','11010120000101001X']]) {
  assert.equal(worker.plausibleContactSource({fieldId:'x',value},[{fieldId:'x',label}],[]),false);
 }
});
test('映射同时区分网页板块条目字段与简历分组条目字段',()=>{
 const base={label:'开始时间',recordIndex:1,resumeKey:'开始时间',resumeGroup:'项目',resumeGroupId:'g',resumeRecordId:'r2',resumeFieldId:'f2'};
 const snapshot=mapping.applyMappingEntries({fields:[]},[{...base,group:'教育经历'},{...base,group:'工作经历'}]).snapshot;
 assert.equal(snapshot.fields.length,2);
 assert.equal(mapping.lookupMapping(snapshot,{label:'开始时间',group:'项目经历',recordIndex:1}),null);
 const hit=mapping.lookupMapping(snapshot,{label:'开始时间',group:'工作经历',recordIndex:1});
 const records=[{group:'教育',key:'开始时间',value:'2020'},{group:'项目',groupId:'g',recordId:'r1',fieldId:'f1',key:'开始时间',value:'2021'},{group:'项目',groupId:'g',recordId:'r2',fieldId:'f2',key:'开始时间',value:'2022'}];
 assert.equal(mapping.resolveMappingSource(hit,records).value,'2022');
 assert.equal(mapping.resolveMappingSource(hit,[...records,records[2]]),null);
 assert.equal(mapping.lookupMapping({fields:[hit,{...hit}]},hit),null);
 assert.equal(mapping.resolveMappingSource({...hit,resumeFieldId:'deleted'},records),null);
 const restored=JSON.parse(mapping.serialize([snapshot])).snapshots[0];
 assert.equal(restored.fields[0].resumeRecordId,'r2');
 assert.equal(restored.fields[0].group,'教育经历');
});
test('同值多来源不学习映射，旧映射作废',()=>{
 assert.deepEqual(mapping.buildMappingEntries([{label:'学校',value:'同一大学'}],[{key:'学校',value:'同一大学'},{key:'学校',value:'同一大学'}],ai.findResumeSource),[]);
 assert.equal(mapping.upgradeMappings({mappingSchema:2,fields:[{resumeKey:'手机'}]}).fields[0].resumeKey,'');
});
test('拦截无来源、跨项目日期、获奖日期串用和协议勾选',()=>{
 const resume=[{fieldId:'p1',recordId:'r1',key:'项目名称',value:'甲项目'},{fieldId:'d1',recordId:'r1',key:'开始时间',value:'2026-01'},{fieldId:'p2',recordId:'r2',key:'项目名称',value:'乙项目'},{fieldId:'home',key:'籍贯',value:'四川'}];
 const fields=[{fieldId:'name',group:'项目经历',recordIndex:2,label:'项目名称'},{fieldId:'date',group:'项目经历',recordIndex:2,label:'开始时间'},{fieldId:'award',label:'获奖时间'},{fieldId:'home',label:'现居住地'},{fieldId:'agree',label:'同意协议'},{fieldId:'paper',label:'论文名称'}];
 const matches=[{fieldId:'name',value:'乙项目',sourceId:'p2'},{fieldId:'date',value:'2026-01',sourceId:'d1'},{fieldId:'award',value:'2026-01',sourceId:'d1'},{fieldId:'home',value:'四川',sourceId:'home'},{fieldId:'agree',value:'true'},{fieldId:'paper',value:'无'}];
 worker.annotateAiSources(matches,resume);
 assert.deepEqual(Array.from(worker.guardResumeSources(matches,fields,resume),m=>m.fieldId),['name']);
});
test('显式来源身份解决同值日期回查歧义',()=>{
 const r=[{fieldId:'a',recordId:'one',key:'开始时间',value:'2026-01'},{fieldId:'b',recordId:'two',key:'开始时间',value:'2026-01'}];
 const m=[{fieldId:'x',value:'2026-01',sourceId:'b'}];worker.annotateAiSources(m,r);
 assert.equal(m[0].resumeRecordId,'two');assert.equal(m[0].ambiguousSource,false);
});
test('合成字段让区间时间与奖项名通过来源核验',()=>{
 const resume=[
  {fieldId:'s1',group:'教育背景',key:'硕士学校',value:'XX大学'},
  {fieldId:'t1',group:'教育背景',key:'硕士时间',value:'2024.9.1-2027.6.1'},
  {fieldId:'a1',group:'奖励',recordId:'r1',recordName:'研究生学业奖学金一等奖',key:'研究生学业奖学金一等奖-获奖时间',value:'2024-9-1'}
 ];
 const expanded=ai.expandResumeFields(resume);
 const fields=[
  {fieldId:'school',group:'教育经历',recordIndex:1,label:'学校名称'},
  {fieldId:'start',group:'教育经历',recordIndex:1,label:'开始时间'},
  {fieldId:'aname',group:'获奖经历',recordIndex:1,label:'获奖名称'},
  {fieldId:'adate',group:'获奖经历',recordIndex:1,label:'获奖时间'}
 ];
 const matches=[
  {fieldId:'school',value:'XX大学',sourceId:'s1'},
  {fieldId:'start',value:'2024-09',sourceId:'syn-t1-start'},
  {fieldId:'aname',value:'研究生学业奖学金一等奖',sourceId:'syn-r1-name'},
  {fieldId:'adate',value:'2024-09',sourceId:'a1'}
 ];
 worker.annotateAiSources(matches,expanded);
 const rejections=[];
 const kept=Array.from(worker.guardResumeSources(matches,fields,expanded,rejections),m=>m.fieldId);
 assert.deepEqual(kept,['school','start','aname','adate'],JSON.stringify(rejections));
 assert.equal(matches[1].relation,'date');
 assert.equal(matches[2].relation,'exact');
});
test('无显式来源且同月多候选时不猜记录，拦下并给出原因',()=>{
 const r=[{fieldId:'a',recordId:'r1',key:'开始时间',value:'2026-01'},{fieldId:'b',recordId:'r2',key:'开始时间',value:'2026-01'}];
 const m=[{fieldId:'x',value:'2026-01'}];
 worker.annotateAiSources(m,r);
 const fields=[{fieldId:'x',group:'项目经历',recordIndex:2,label:'开始时间'}];
 const rejections=[];
 assert.deepEqual(Array.from(worker.guardResumeSources(m,fields,r,rejections)),[],'分不清记录时应当拦下而不是猜');
 assert.equal(rejections[0].reason,'日期来源缺失或存在多个候选','同值两条候选分不清时应当拦下而不是猜');
 assert.equal(rejections[0].value,'2026-01','拒绝记录要带上被拦的值，对照表才能直接看出问题');
});

test('多来源描述保留 sourceIds，只接受同记录原句，拒绝跨记录、未知来源和新增事实',()=>{
 const resume=[
  {fieldId:'name',group:'项目',recordId:'r1',key:'项目名称',value:'示例项目'},
  {fieldId:'a',group:'项目',recordId:'r1',key:'内容概述',value:'研究并实现路径规划系统。'},
  {fieldId:'b',group:'项目',recordId:'r1',key:'主要工作',value:'设计调度模块并完成验证。'},
  {fieldId:'c',group:'项目',recordId:'r2',key:'主要工作',value:'研究失效恢复并完成验证。'}
 ];
 const text='设计调度模块并完成验证。研究并实现路径规划系统。';
 const fields=[{fieldId:'n',label:'项目名称',group:'项目',recordIndex:1},{fieldId:'d',label:'项目描述',group:'项目',recordIndex:1}];
 const check=(value,sourceIds)=>{
  const m=worker.normalizeMatches([{fieldId:'n',value:'示例项目',sourceId:'name'},{fieldId:'d',value,sourceIds}]);
  worker.annotateAiSources(m,resume);return {m,kept:Array.from(worker.guardResumeSources(m,fields,resume),m=>m.fieldId)};
 };
 const good=check(text,['a','b']);assert.deepEqual(good.kept,['n','d']);assert.equal(good.m[1].relation,'composed');assert.equal(good.m[1].resumeRecordId,'r1');
 for(const [value,ids] of [[text,['a','b','missing']],[text,['a','c']],[text+'获奖。',['a','b']],[text+'奖励金额一百万元。',['a','b']],[text,[]]])assert.deepEqual(check(value,ids).kept,['n']);
 const legacy=worker.normalizeMatches([{fieldId:'d',value:text,sourceId:'b'}]);worker.annotateAiSources(legacy,resume);assert.equal(legacy[0].relation,'composed');
 assert.equal(legacy[0].resumeRecordId,'r1');assert.equal(legacy[0].sourceIds.length,2);
});

test('同月不同写法也须保留来源歧义；获奖项建立记录锚点',()=>{
 const r=[{fieldId:'n1',group:'获奖',recordId:'r1',key:'获奖名称',value:'示例奖项'},
  {fieldId:'a',group:'获奖',recordId:'r1',key:'获奖时间',value:'2023年9月'},
  {fieldId:'b',group:'获奖',recordId:'r2',key:'获奖时间',value:'2023/09'}];
 assert.equal(ai.findResumeSource('2023-09',r).ambiguous,true);
 const fields=[{fieldId:'n',group:'获奖',label:'获奖项',recordIndex:1},{fieldId:'d',group:'获奖',label:'获奖时间',recordIndex:1}];
 for(const [id,kept] of [['a',['n','d']],['b',['n']]]){
  const m=[{fieldId:'n',value:'示例奖项',sourceId:'n1'},{fieldId:'d',value:'2023-09',sourceId:id}];worker.annotateAiSources(m,r);
  assert.deepEqual(Array.from(worker.guardResumeSources(m,fields,r),m=>m.fieldId),kept);
 }
});

test('项目及校园描述不能引用另一条已明确记录的内容',()=>{
 const r=[{fieldId:'n',recordId:'r1',key:'职位',value:'干事'},{fieldId:'c',recordId:'r2',key:'内容概述',value:'另一组织的活动内容'}];
 const fields=[{fieldId:'n',group:'校园经历',recordIndex:1,label:'职务名称'},{fieldId:'d',group:'校园经历',recordIndex:1,label:'职务描述'}];
 const m=[{fieldId:'n',value:'干事',sourceId:'n'},{fieldId:'d',value:'另一组织的活动内容',sourceId:'c'}];worker.annotateAiSources(m,r);
 assert.deepEqual(Array.from(worker.guardResumeSources(m,fields,r),m=>m.fieldId),['n']);
});

test('同名奖项的旧字段后缀按独立记录展开，不把编号写进获奖名称',()=>{
 const tree=require('../resume-tree');
 const template=tree.normalizeTemplate({id:'t',name:'匿名资料',groups:[{name:'奖励',fields:[1,2,3].map(n=>({
  key:'示例学业奖学金一等奖-获奖时间'+(n>1?' ('+n+')':''),value:(2023+n)+'-09'
 }))}]});
 const group=template.groups[0];
 const resume=group.fields.map(f=>({...f,fieldId:f.id,group:group.name,groupId:group.id,recordName:group.records.find(r=>r.id===f.recordId).name}));
 const expanded=ai.expandResumeFields(resume),names=expanded.filter(f=>f.synthetic);
 assert.equal(names.length,3);
 assert.deepEqual(names.map(f=>f.value),Array(3).fill('示例学业奖学金一等奖'));
 assert.equal(new Set(names.map(f=>f.recordId)).size,3);
 const fields=[],matches=[];
 names.forEach((n,i)=>{
  fields.push({fieldId:'n'+i,group:'获奖经历',label:'获奖项',recordIndex:i+1},{fieldId:'d'+i,group:'获奖经历',label:'获奖时间',recordIndex:i+1});
  matches.push({fieldId:'n'+i,value:n.value,sourceId:n.fieldId},{fieldId:'d'+i,value:resume[i].value,sourceId:resume[i].fieldId});
 });
 worker.annotateAiSources(matches,expanded);
 assert.equal(worker.guardResumeSources(matches,fields,expanded).length,6);
 const wrong=[{fieldId:'n0',value:names[0].value,sourceId:names[0].fieldId},{fieldId:'d0',value:resume[1].value,sourceId:resume[1].fieldId}];
 worker.annotateAiSources(wrong,expanded);
 assert.deepEqual(Array.from(worker.guardResumeSources(wrong,fields,expanded),m=>m.fieldId),['n0']);
 assert.equal(ai.findResumeSource(names[0].value,expanded).ambiguous,true);
});

test('复选框拒绝来源真实的日期；至今标记也须与项目记录一致',()=>{
 const fields=[{fieldId:'n',group:'项目经历',recordIndex:1,label:'项目名称'},
  {fieldId:'c',group:'项目经历',recordIndex:1,label:'至今',inputType:'checkbox'}];
 const resume=[{fieldId:'n1',group:'项目',recordId:'r1',key:'项目名称',value:'示例项目'},
  {fieldId:'d',group:'项目',recordId:'r1',key:'结束时间',value:'2026-09-01'},
  {fieldId:'ongoing',group:'项目',recordId:'r1',key:'结束时间',value:'至今'},
  {fieldId:'other',group:'项目',recordId:'r2',key:'结束时间',value:'至今'}];
 const check=(value,sourceId)=>{
  const m=[{fieldId:'n',value:'示例项目',sourceId:'n1'},{fieldId:'c',value,sourceId}];
  worker.annotateAiSources(m,resume);return Array.from(worker.guardResumeSources(m,fields,resume),m=>m.fieldId);
 };
 assert.deepEqual(check('2026-09-01','d'),['n']);
 assert.deepEqual(check('至今','ongoing'),['n','c']);
 assert.deepEqual(check('至今','other'),['n']);
 for(const value of ['2026-9-1','示例项目','请选择'])assert.equal(ai.isValueValidForField(fields[1],value),false);
});

test('描述缺失或改写被拒绝时，只补已唯一锚定记录的原文',async()=>{
 const resume=[
  {fieldId:'n1',group:'项目经历',groupId:'g',recordId:'r1',key:'项目名称',value:'项目甲'},
  {fieldId:'n2',group:'项目经历',groupId:'g',recordId:'r2',key:'项目名称',value:'项目乙'},
  {fieldId:'a',group:'项目经历',groupId:'g',recordId:'r2',key:'项目乙-内容概述',label:'内容概述',value:'研究并实现数据分析系统。'},
  {fieldId:'b',group:'项目经历',groupId:'g',recordId:'r2',key:'项目乙-主要工作',label:'主要工作',value:'开发测试工具并完成验证。'},
  {fieldId:'other',group:'项目经历',groupId:'g',recordId:'r1',key:'内容概述',value:'另一条经历的内容。'}
 ];
 const fields=[{fieldId:'n',label:'项目名称',group:'项目经历',recordIndex:2,inputType:'text'},
  {fieldId:'d',label:'项目描述',group:'项目经历',recordIndex:2,inputType:'textarea'}];
 const matches=[{fieldId:'n',value:'项目乙',sourceId:'n2'}];worker.annotateAiSources(matches,resume);
 const output=Array.from(worker.buildRecordNarrativeMatches(fields,resume,matches));
 assert.equal(output.length,1);assert.equal(output[0].source,'local');assert.equal(output[0].resumeRecordId,'r2');
 assert.equal(output[0].value,'研究并实现数据分析系统。\n开发测试工具并完成验证。');
 assert.deepEqual(Array.from(output[0].sourceIds),['a','b']);
 assert.equal(worker.buildRecordNarrativeMatches(fields,resume,[]).length,0,'不能仅按第2条猜简历记录');
 assert.equal(worker.buildRecordNarrativeMatches(fields,[...resume,{...resume[2],fieldId:'duplicate',value:'另一份概述'}],matches).length,0);
 assert.equal(worker.buildRecordNarrativeMatches(fields,resume,[{...matches[0],ambiguousSource:true}]).length,0);
 const wrongPage=[fields[0],{...fields[1],recordIndex:1}];
 assert.equal(worker.buildRecordNarrativeMatches(wrongPage,resume,matches).length,0,'不补到另一条网页经历');
 assert.equal(worker.buildRecordNarrativeMatches([fields[0],{...fields[1],label:'项目描述附件链接'}],resume,matches).length,0,'字段名仅包含描述不够，链接不能接收正文');
 const contained=resume.map(r=>r.fieldId==='a'?{...r,value:r.value+'\n'+resume[3].value}:r);
 assert.equal(worker.buildRecordNarrativeMatches(fields,contained,matches)[0].value,contained[2].value,'概述已包含职责时不重复拼接');
 const collision=[...resume,{fieldId:'foreign',group:'校园经历',groupId:'other',recordId:'r2',key:'描述',value:'另一分组的内容'}];
 assert.equal(worker.buildRecordNarrativeMatches(fields,collision,matches)[0].value,output[0].value,'记录id碰撞仍需核对分组');
 worker.fetch=async()=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify([
  {fieldId:'n',value:'项目乙',sourceId:'n2'},
  {fieldId:'d',value:'凭空新增的项目内容。',sourceId:'missing'}
 ])}}]})});
 const result=await worker.handleAiFill({formFields:fields,resumeFields:resume,aiConfig:{apiUrl:'https://fixture.invalid',model:'fixture',apiKey:'fixture'}});
 assert.equal(result.diagnostics.rejectedSources,1);assert.equal(result.diagnostics.recordFallbackMatches,1);
 assert.equal(result.matches.find(m=>m.fieldId==='d').value,output[0].value,'替换为真实原文，不放行原来被拒绝的文字');
});

test('同段两个锚点指向不同简历记录时不补描述；有歧义的描述不复用',()=>{
 const resume=[{fieldId:'a',group:'项目经历',recordId:'r1',key:'项目名称',value:'项目甲'},
  {fieldId:'b',group:'项目经历',recordId:'r2',key:'单位名称',value:'单位乙'},
  {fieldId:'body',group:'项目经历',recordId:'r1',key:'描述',value:'项目甲的原始描述'}];
 const fields=[{fieldId:'n1',label:'项目名称',group:'项目经历',recordIndex:1},
  {fieldId:'n2',label:'单位名称',group:'项目经历',recordIndex:1},
  {fieldId:'d',label:'项目描述',group:'项目经历',recordIndex:1,inputType:'textarea'}];
 const matches=[{fieldId:'n1',value:'项目甲',sourceId:'a'},{fieldId:'n2',value:'单位乙',sourceId:'b'}];
 worker.annotateAiSources(matches,resume);
 assert.equal(worker.buildRecordNarrativeMatches(fields,resume,matches).length,0);
});

test('在校职务旧键可以分条归档，不合并两项校园任职',()=>{
 const tree=require('../resume-tree');
 const template=tree.normalizeTemplate({id:'t',groups:[{name:'在校职务',fields:[
  {key:'社团联合会-职位',value:'干事'},{key:'社团联合会-描述',value:'策划社团活动'},
  {key:'创新训练项目-职位',value:'队长'},{key:'创新训练项目-描述',value:'组织项目验证'}
 ]}]});
 assert.equal(template.groups[0].records.length,2);
 assert.deepEqual(template.groups[0].fields.map(f=>f.label),['职位','描述','职位','描述']);
 assert.equal(template.groups[0].fields[0].recordId,template.groups[0].fields[1].recordId);
 assert.notEqual(template.groups[0].fields[1].recordId,template.groups[0].fields[2].recordId);
});

test('同义学历按用途核验；没有教育记录归属的全局学位不指认本科学历',()=>{
 const level={fieldId:'level',label:'学历'},degree={fieldId:'degree',label:'学位'};
 const resume=[{fieldId:'master',key:'学历',value:'硕士'}, {fieldId:'bachelor',key:'学位',value:'学士'}];
 const matches=[{fieldId:'level',value:'硕士研究生',sourceId:'master'},{fieldId:'degree',value:'学士学位',sourceId:'bachelor'}];
 worker.annotateAiSources(matches,resume,[level,degree]);
 assert.deepEqual(matches.map(m=>m.relation),['equivalent','equivalent']);
 assert.equal(worker.guardResumeSources(matches,[level,degree],resume).length,2);
 for(const [value,source] of [['本科','bachelor'],['学士','bachelor'],['研究生','master'],['博士后','master']]){
  const m=[{fieldId:'level',value,sourceId:source}];worker.annotateAiSources(m,resume,[level]);
  assert.equal(worker.guardResumeSources(m,[level],resume).length,0);
 }
 assert.equal(ai.findResumeSource('硕士研究生',[resume[0],{...resume[0],fieldId:'other'}],level).ambiguous,true);
 const source=ai.findResumeSource('硕士研究生',resume);assert.equal(source.relation,'none','不把别的字段里的硕士做全局同义替换');
});

test('全局最高学历须有本条教育记录的层次证据，不能套到另一行或按序号猜',()=>{
 const resume=[{fieldId:'global',group:'基本信息',recordId:'basic',key:'学历',value:'硕士'},
  {fieldId:'school1',group:'教育背景',recordId:'masters',key:'硕士学校',value:'同一大学'},
  {fieldId:'school2',group:'教育背景',recordId:'bachelors',key:'学士学校',value:'同一大学'},
  {fieldId:'explicit',group:'教育背景',recordId:'bachelors',key:'本科-学历',label:'学历',value:'大学本科'}];
 const fields=[1,2].flatMap(i=>[{fieldId:'school'+i,label:'学校名称',group:'教育经历',recordIndex:i},
  {fieldId:'level'+i,label:'学历',group:'教育经历',recordIndex:i}]);
 const check=(value,id,row=1,anchors=true)=>{
  const matches=(anchors?[1,2].map(i=>({fieldId:'school'+i,value:'同一大学',sourceId:'school'+i})):[]);
  matches.push({fieldId:'level'+row,value,sourceId:id});worker.annotateAiSources(matches,resume,fields);
  return Array.from(worker.guardResumeSources(matches,fields,resume),m=>m.fieldId);
 };
 assert.ok(check('硕士研究生','global').includes('level1'));
 assert.ok(!check('硕士研究生','global',2).includes('level2'));
 assert.ok(!check('硕士研究生','global',1,false).includes('level1'));
 assert.ok(check('本科','explicit',2).includes('level2'));
 assert.ok(!check('本科','explicit',1).includes('level1'));
});

test('描述已确认记录时补该记录明确职务，来源缺失、多候选和别条记录均不猜',()=>{
 const fields=[{fieldId:'role',label:'职务名称',group:'校园经历',recordIndex:2,inputType:'text'},
  {fieldId:'body',label:'职务描述',group:'校园经历',recordIndex:2,inputType:'textarea'}];
 const resume=[{fieldId:'body-source',group:'校园经历',groupId:'g',recordId:'badminton',key:'羽毛球协会-描述',label:'描述',value:'组织羽毛球比赛并担任裁判。'},
  {fieldId:'role-source',group:'校园经历',groupId:'g',recordId:'badminton',key:'羽毛球协会-职位',label:'职位',value:'干事'},
  {fieldId:'other-role',group:'校园经历',groupId:'g',recordId:'research',key:'研究项目-职位',label:'职位',value:'队长'}];
 const matches=[{fieldId:'body',value:resume[0].value,sourceId:'body-source'}];worker.annotateAiSources(matches,resume,fields);
 const output=Array.from(worker.buildRecordFactMatches(fields,resume,matches));
 assert.equal(output.length,1);assert.equal(output[0].value,'干事');assert.equal(output[0].resumeRecordId,'badminton');
 assert.equal(worker.buildRecordFactMatches(fields,resume.filter(r=>r.fieldId!=='role-source'),matches).length,0);
 assert.equal(worker.buildRecordFactMatches(fields,[...resume,{...resume[1],fieldId:'duplicate',value:'会长'}],matches).length,0);
 assert.equal(worker.buildRecordFactMatches(fields,resume,[]).length,0);
 assert.equal(worker.buildRecordFactMatches([{...fields[0],recordIndex:1},fields[1]],resume,matches).length,0);
 assert.equal(worker.buildRecordFactMatches(fields,resume.map(r=>({...r,group:'项目经历'})),matches).length,0,'已知不同分组不能靠同一recordId串用');
 const partial=ai.findResumeSource('羽毛球比赛',[resume[0],{...resume[0],recordId:'other',fieldId:'duplicate'}]);
 assert.equal(partial.ambiguous,true,'无来源id的截取也须保留多候选歧义');
});

test('语言漏匹配只补该语种的显式水平，听说读写分开，考试成绩不换算能力',()=>{
 const fields=['语言类型','掌握程度','听说','读写'].map((label,i)=>({fieldId:'f'+i,label,group:'语言能力',recordIndex:1,inputType:'combobox'}));
 const resume=[{fieldId:'lang',group:'语言能力',groupId:'g',recordId:'english',key:'英语水平',value:'英语，六级520，掌握程度：良好，听说：一般，读写：熟练'},
  {fieldId:'other',group:'语言能力',groupId:'g',recordId:'japanese',key:'日语-掌握程度',label:'掌握程度',value:'精通'}];
 const matches=[{fieldId:'f0',value:'英语',sourceId:'lang'}];worker.annotateAiSources(matches,resume,fields);
 const result=Array.from(worker.buildRecordFactMatches(fields,resume,matches));
 assert.deepEqual(result.map(m=>[m.fieldId,m.value,m.resumeRecordId]),[['f1','良好','english'],['f2','一般','english'],['f3','熟练','english']]);
 for(const value of ['英语，六级520','英语，六级成绩良好','英语，六级520，掌握程度：良好，掌握程度：一般']){
  assert.equal(worker.buildRecordFactMatches(fields,[{...resume[0],value}],matches).length,0,value);
 }
 assert.equal(worker.buildRecordFactMatches(fields,[{...resume[0],value:'英语良好，日语精通，听说：熟练'}],matches).length,0,'混合语种的能力归属不明时停止');
 assert.equal(worker.buildRecordFactMatches(fields,[{...resume[0],value:'英语：良好'}],matches).length,1,'综合水平不能复制到听说读写');
 assert.equal(worker.buildRecordFactMatches(fields,[...resume,{fieldId:'conflict',group:'语言能力',groupId:'g',recordId:'english',key:'掌握程度',value:'一般'}],matches).filter(m=>m.fieldId==='f1').length,0);
});

test('同条明确学位可推导学历；明确学历优先，重复事实复用，冲突或其他记录不复制',()=>{
 const fields=[{fieldId:'school',label:'学校名称',group:'教育经历',recordIndex:1,inputType:'text'},
  {fieldId:'level',label:'学历',group:'教育经历',recordIndex:1,inputType:'combobox',options:['大学本科','硕士研究生']}];
 const resume=[{fieldId:'school-source',group:'教育背景',recordId:'bachelor',key:'学士学校',value:'示例大学'},
  {fieldId:'degree-source',group:'教育背景',recordId:'bachelor',key:'学位',value:'学士'},
  {fieldId:'other-level',group:'教育背景',recordId:'master',key:'学历',value:'硕士'}];
 const matches=[{fieldId:'school',value:'示例大学',sourceId:'school-source'}];worker.annotateAiSources(matches,resume,fields);
 const inferred=Array.from(worker.buildRecordFactMatches(fields,resume,matches));
 assert.equal(inferred.length,1);assert.equal(inferred[0].value,'本科');assert.equal(inferred[0].relation,'inferred');assert.equal(inferred[0].resumeFieldId,'degree-source');
 const explicit=[...resume,{fieldId:'level-source',group:'教育背景',recordId:'bachelor',key:'学历',value:'本科'}];
 const output=Array.from(worker.buildRecordFactMatches(fields,explicit,matches));
 assert.equal(output.length,1);assert.equal(output[0].value,'本科');assert.equal(output[0].resumeFieldId,'level-source');
 assert.equal(worker.buildRecordFactMatches(fields,[...explicit,{...explicit[3],fieldId:'duplicate'}],matches).length,1);
 assert.equal(worker.buildRecordFactMatches(fields,[...explicit,{...explicit[3],fieldId:'conflict',value:'大专'}],matches).length,0);
});
