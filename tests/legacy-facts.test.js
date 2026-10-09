const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const ai = require('../ai-helpers');
function worker() {
 const context={importScripts(){},ResumeProAIHelpers:ai,AbortController,TextEncoder,performance,setTimeout,clearTimeout};
 context.self=context;vm.createContext(context);vm.runInContext(fs.readFileSync(require.resolve('../ai-worker.js'),'utf8'),context);return context;
}
const campus = () => [
 {fieldId:'raw',group:'校园经历',groupId:'g',recordId:'unclassified',key:'校园2',label:'校园2',value:'示例大学球类协会干事，组织比赛，担任裁判。'},
 {fieldId:'org',group:'校园经历',groupId:'g',recordId:'club',recordName:'示例大学球类协会',key:'球类协会-活动名称',label:'活动名称',value:'示例大学球类协会'},
 {fieldId:'description',group:'校园经历',groupId:'g',recordId:'club',recordName:'示例大学球类协会',key:'球类协会-描述',label:'描述',value:'组织比赛，担任裁判。'}
];
const campusFields = () => ['职务名称','职务描述'].map((label,i)=>({fieldId:'c'+i,label,group:'校园经历',recordIndex:2,inputType:i?'textarea':'text'}));

test('电话备注可格式化，保留来源并排除账号、联系人、多号码和冲突',()=>{
 const form=[{fieldId:'phone',label:'手机号码',inputType:'tel'}];
 const source={fieldId:'p',key:'电话',group:'基本信息',value:'13800000000（微信同号）'};
 const result=ai.buildRuleBasedMatches(form,[source]);
 assert.equal(result.length,1);assert.equal(result[0].value,'13800000000');assert.equal(result[0].resumeFieldId,'p');
 assert.equal(result[0].relation,'formatted');
 const w=worker();assert.equal(w.plausibleContactSource({fieldId:'phone',value:'13800000000'},form,[source]),true);
 for(const invalid of [
  {...source,key:'邮箱',value:'13800000000@example.test'},
  {...source,key:'邮箱',group:'联系方式',value:'13800000000'},
  {...source,key:'微信号',value:'13800000000'},
  {...source,key:'紧急联系人电话'},
  {...source,value:'13800000000（父亲）'},
  {...source,value:'13800000000 / 13900000000'},
 ])assert.equal(ai.buildRuleBasedMatches(form,[invalid]).length,0,invalid.key+' '+invalid.value);
 assert.equal(ai.buildRuleBasedMatches(form,[source,{...source,fieldId:'other',value:'13900000000'}]).length,0);
 assert.equal(w.plausibleContactSource({fieldId:'phone',value:'13900000000'},form,[source]),false);
});

test('旧校园整句的组织与职务明确时，补出所属记录的事实，不修改原文',()=>{
 const resume=campus(),before=JSON.stringify(resume),expanded=ai.expandResumeFields(resume);
 const role=expanded.find(r=>r.synthetic&&r.label==='职位');
 assert.ok(role);assert.equal(role.value,'干事');assert.equal(role.recordId,'club');assert.equal(role.groupId,'g');
 assert.deepEqual(role.derivedFrom,['raw','org']);assert.equal(JSON.stringify(resume),before);
 for(const value of ['示例大学球类协会，组织比赛，担任裁判。','参与示例大学球类协会活动，组织比赛。','示例大学球类协会干事，另一大学球类协会会长。']){
  const input=[{...resume[0],value},...resume.slice(1)];
  if(value.includes('另一大学'))input.push({...resume[1],fieldId:'other-org',recordId:'other',value:'另一大学球类协会'});
  assert.equal(ai.expandResumeFields(input).filter(r=>r.synthetic&&r.label==='职位').length,0,value);
 }
 assert.equal(ai.expandResumeFields([...resume,{...resume[1],fieldId:'duplicate-org',recordId:'other'}]).filter(r=>r.synthetic&&r.label==='职位').length,0);
 assert.equal(ai.expandResumeFields([...resume,{...resume[2],fieldId:'role',label:'职位',key:'球类协会-职位',value:'会长'}]).filter(r=>r.synthetic&&r.label==='职位').length,0);
});

test('用途错误的职务候选不污染记录归属，正确描述仍能带出本条职务',()=>{
 const w=worker(),resume=ai.expandResumeFields(campus()),fields=campusFields();
 const proposed=[{fieldId:'c0',value:'干事',sourceId:'raw'},{fieldId:'c1',value:'组织比赛，担任裁判。',sourceId:'description'}];
 w.annotateAiSources(proposed,resume,fields);
 const rejected=[],kept=w.guardResumeSources(proposed,fields,resume,rejected);
 assert.deepEqual(Array.from(kept,m=>m.fieldId),['c1']);assert.equal(rejected[0].reason,'职务来源用途不对应');
 const facts=w.buildRecordFactMatches(fields,resume,kept);
 assert.deepEqual(Array.from(facts,m=>[m.fieldId,m.value,m.resumeRecordId]),[['c0','干事','club']]);
});

test('同值职务不能覆盖能唯一确定条目的原文描述',()=>{
 const w=worker(),resume=[
  {fieldId:'r1',group:'校园经历',groupId:'g',recordId:'one',key:'甲-职位',label:'职位',value:'干事'},
  {fieldId:'r2',group:'校园经历',groupId:'g',recordId:'two',key:'乙-职位',label:'职位',value:'干事'},
  {fieldId:'d2',group:'校园经历',groupId:'g',recordId:'two',key:'乙-描述',label:'描述',value:'组织球类比赛。'}
 ],fields=campusFields();
 const matches=[{fieldId:'c0',value:'干事',sourceId:'r1'},{fieldId:'c1',value:'组织球类比赛。',sourceId:'d2'}];w.annotateAiSources(matches,resume,fields);
 const kept=w.guardResumeSources(matches,fields,resume);
 assert.deepEqual(Array.from(kept,m=>m.fieldId),['c1']);
 assert.deepEqual(Array.from(w.buildRecordFactMatches(fields,resume,kept),m=>[m.value,m.resumeRecordId]),[['干事','two']]);
 assert.equal(w.guardResumeSources([matches[0]],[fields[0]],resume).length,0,'重复职务没有名称或原文依据时停止');
});

test('自然语言的明确听说水平可用，阅读不等于读写，考试不等于综合水平',()=>{
 const w=worker(),fields=['语言类型','掌握程度','听说','读写'].map((label,i)=>({fieldId:'l'+i,label,group:'语言能力',recordIndex:1,inputType:'combobox'}));
 const resume=[{fieldId:'english',group:'技能',groupId:'skills',recordId:'basic',key:'英语水平',label:'英语水平',value:'全国大学英语四级(CET-4)，全国大学英语六级(CET-6)，具有良好的英语听说以及阅读能力'}];
 const matches=[{fieldId:'l0',value:'英语',sourceId:'english'}];w.annotateAiSources(matches,resume,fields);
 assert.deepEqual(Array.from(w.buildRecordFactMatches(fields,resume,matches),m=>[m.fieldId,m.value]),[['l2','良好']]);
 for(const value of ['英语六级成绩良好','具有良好的英语阅读能力','具有良好的英语听力能力','英语听说不够良好','英语听说良好，听说一般']){
  assert.equal(w.languageFactValue(fields[2],{...resume[0],value},'英语'),'',value);
 }
 assert.equal(w.languageFactValue(fields[3],{...resume[0],value:'具有良好的英语听说以及阅读和写作能力'},'英语'),'良好');
 assert.equal(w.languageFactValue(fields[3],{...resume[0],value:'英语听说读写良好'},'英语'),'良好');
 assert.equal(w.languageFactValue(fields[2],{...resume[0],value:'日语，听说：良好'},'英语'),'');
});

test('后台完整匹配：AI漏电话、错误校园职务和笼统能力由真实来源补空',async()=>{
 const w=worker(),fields=[...campusFields(),{fieldId:'phone',label:'手机号码',group:'个人信息',inputType:'tel'},...['语言类型','掌握程度','听说','读写'].map((label,i)=>({fieldId:'l'+i,label,group:'语言能力',recordIndex:1,inputType:'combobox'}))];
 const resume=ai.expandResumeFields([...campus(),{fieldId:'phone-source',key:'电话',group:'基本信息',value:'13800000000（微信同号）'},
  {fieldId:'language-source',key:'英语水平',label:'英语水平',group:'技能',groupId:'skills',recordId:'skills-basic',value:'英语六级，具有良好的英语听说以及阅读能力'}]);
 const proposed=[{fieldId:'c0',value:'干事',sourceId:'raw'},{fieldId:'c1',value:'组织比赛，担任裁判。',sourceId:'description'},
  {fieldId:'l0',value:'英语',sourceId:'language-source'},{fieldId:'l1',value:'良好',sourceId:'language-source'}];
 w.fetch=async()=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(proposed)}}]})});
 const result=await w.handleAiFill({formFields:fields,resumeFields:resume,aiConfig:{apiUrl:'https://fixture.invalid/ai',model:'fixture',apiKey:'fixture'}});
 assert.equal(result.success,true);assert.deepEqual(Array.from(result.matches,m=>[m.fieldId,m.value]).sort(),[['c0','干事'],['c1','组织比赛，担任裁判。'],['l0','英语'],['l2','良好'],['phone','13800000000']].sort());
 assert.equal(result.diagnostics.recordFactMatches,2);assert.equal(result.diagnostics.rejectedSources,2);
});

test('旧教育待归类记录按明确字段前缀分出来源身份，同校不同阶段不能串日期',()=>{
 const resume=[['masters-school','硕士学校','示例大学'],['masters-time','硕士时间','2024.9.1-2027.6.1'],
  ['bachelors-school','学士学校','示例大学'],['bachelors-time','学士时间','2020.9.1-2024.6.1']].map(([fieldId,key,value])=>({fieldId,key,label:key,value,group:'教育背景',groupId:'education',recordId:'legacy',recordName:'待归类资料'}));
 const original=JSON.stringify(resume),expanded=ai.expandResumeFields(resume),master=expanded.find(r=>r.fieldId==='masters-school'),bachelor=expanded.find(r=>r.fieldId==='bachelors-school');
 assert.notEqual(master.recordId,bachelor.recordId);assert.equal(master.recordName,'硕士阶段');assert.equal(bachelor.recordName,'学士阶段');
 const mapping=require('../form-structure'),cached={resumeKey:master.key,resumeGroup:master.group,resumeGroupId:master.groupId,resumeRecordId:'legacy',resumeFieldId:master.fieldId};
 assert.equal(mapping.resolveMappingSource(cached,expanded),null,'旧混合记录映射不能越过新的来源身份');
 assert.equal(mapping.resolveMappingSource({...cached,resumeRecordId:master.recordId},expanded).value,'示例大学');
 assert.equal(JSON.stringify(resume),original);assert.deepEqual(expanded.slice(0,4).map(r=>[r.fieldId,r.key,r.value]),resume.map(r=>[r.fieldId,r.key,r.value]));
 const w=worker(),fields=[{fieldId:'school',group:'教育经历',recordIndex:2,label:'学校名称'},{fieldId:'start',group:'教育经历',recordIndex:2,label:'开始时间'}];
 const check=id=>{const matches=[{fieldId:'school',value:'示例大学',sourceId:'bachelors-school'},{fieldId:'start',value:id.startsWith('syn-masters')?'2024-09':'2020-09',sourceId:id}];w.annotateAiSources(matches,expanded,fields);return Array.from(w.guardResumeSources(matches,fields,expanded),m=>m.fieldId);};
 assert.deepEqual(check('syn-bachelors-time-start'),['school','start']);assert.deepEqual(check('syn-masters-time-start'),['school']);
 assert.equal(expanded.some(r=>ai.educationFieldTopic(r)==='education'),false,'学士前缀不能合成本科学历');
 const curated=ai.expandResumeFields(resume.map(r=>({...r,recordName:'本人明确合并的记录'})));
 assert.ok(curated.every(r=>r.recordId==='legacy'),'不拆用户已明确命名的记录');
});

test('AI 只给月份时保留来源的具体日；来源仅有月份时仍需补日提示',()=>{
 const w=worker(),fields=[{fieldId:'birth',label:'出生日期',inputType:'date'},
  {fieldId:'award',label:'获奖时间',inputType:'date-picker'},
  {fieldId:'monthly',label:'获奖时间',inputType:'date-picker'}];
 const resume=[{fieldId:'birthday',key:'生日',value:'2000年5月17日'},
  {fieldId:'award-source',key:'获奖时间',value:'2024-09-28'},
  {fieldId:'month-source',key:'获奖时间',value:'2023-09'}];
 const matches=[{fieldId:'birth',value:'2000-05',sourceId:'birthday'},
  {fieldId:'award',value:'2024-09',sourceId:'award-source'},
  {fieldId:'monthly',value:'2023-09',sourceId:'month-source'}];
 w.annotateAiSources(matches,resume,fields);
 assert.deepEqual(matches.map(m=>m.value),['2000-05-17','2024-09-28','2023-09']);
 assert.equal(w.guardResumeSources(matches,fields,resume).length,3);
 assert.equal(ai.normalizeDateForPrecision(matches[1].value,'day').padded,false);
 assert.equal(ai.normalizeDateForPrecision(matches[2].value,'day').padded,true);
 const ambiguous=[{fieldId:'award',value:'2024-09'}];
 w.annotateAiSources(ambiguous,[resume[1],{...resume[1],fieldId:'another-day',value:'2024-09-17'}],fields);
 assert.equal(ambiguous[0].value,'2024-09');assert.equal(ambiguous[0].ambiguousSource,true,'多个候选时不挑其中一天');
 const expanded=ai.expandResumeFields([{fieldId:'period',group:'教育背景',key:'硕士时间',value:'2024.9.28-2027.6.17'}]);
 const range=[{fieldId:'start',label:'开始时间',inputType:'date'}],target=[{fieldId:'start',value:'2024-9',sourceId:'syn-period-start'}];
 w.annotateAiSources(target,expanded,range);
 assert.equal(target[0].value,'2024-09-28');assert.equal(w.guardResumeSources(target,range,expanded).length,1);
});
