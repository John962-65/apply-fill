const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const ai=require('../ai-helpers');
const worker={importScripts(){},ResumeProAIHelpers:ai,chrome:{runtime:{onMessage:{addListener(){}}}},AbortController,TextEncoder,performance,setTimeout,clearTimeout};
worker.self=worker;vm.createContext(worker);
vm.runInContext(fs.readFileSync(require.resolve('../ai-worker.js'),'utf8'),worker);

function campusFixture(){
 const records=[['club','负责社团公众号运营，策划活动。'],['sports','组织球类比赛，担任裁判。']];
 const resume=records.flatMap(([recordId,description])=>[
  {fieldId:recordId+'-role',group:'校园经历',recordId,label:'担任职务',key:recordId+'-担任职务',value:'干事'},
  {fieldId:recordId+'-body',group:'校园经历',recordId,label:'经历描述',key:recordId+'-经历描述',value:description},
  {fieldId:recordId+'-start',group:'校园经历',recordId,label:'开始时间',key:recordId+'-开始时间',value:'2020-09-01'},
  {fieldId:recordId+'-end',group:'校园经历',recordId,label:'结束时间',key:recordId+'-结束时间',value:'2022-06-01'}]);
 const fields=records.flatMap(([recordId],i)=>['职务名称','职务描述','开始时间','结束时间'].map((label,n)=>({fieldId:recordId+'-'+n,group:'校园经历',recordIndex:i+1,label})));
 const matches=fields.map(f=>{
  const suffix={职务名称:'role',职务描述:'body',开始时间:'start',结束时间:'end'}[f.label];
  const source=resume.find(s=>s.fieldId===f.fieldId.split('-')[0]+'-'+suffix);
  return {fieldId:f.fieldId,value:source.value,sourceId:source.fieldId};
 });
 return {fields,resume,matches};
}

test('校园同值职务用各自唯一原文描述确认记录，四个日期按来源通过校验',()=>{
 const {fields,resume,matches}=campusFixture();
 const check=proposed=>{worker.annotateAiSources(proposed,resume,fields);return Array.from(worker.guardResumeSources(proposed,fields,resume),m=>m.fieldId);};
 assert.equal(check(matches).length,8);
 const wrong=matches.map(m=>({...m}));wrong.find(m=>m.fieldId==='sports-2').sourceId='club-start';
 assert.ok(!check(wrong).includes('sports-2'),'same date from another record still rejected');
 assert.ok(!check(matches.filter(m=>!m.fieldId.endsWith('-1'))).some(id=>/-[23]$/.test(id)),'common roles alone never bind dates');
});

test('相同描述、描述冲突及错误用途不能用于确认多条校园日期',()=>{
 const {fields,resume,matches}=campusFixture();
 const ambiguous=resume.map(s=>s.fieldId==='sports-body'?{...s,value:resume.find(r=>r.fieldId==='club-body').value}:s);
 const candidates=matches.map(m=>({...m,value:m.fieldId==='sports-1'?ambiguous.find(r=>r.fieldId==='sports-body').value:m.value}));
 worker.annotateAiSources(candidates,ambiguous,fields);
 assert.ok(!Array.from(worker.guardResumeSources(candidates,fields,ambiguous)).some(m=>/-[23]$/.test(m.fieldId)),'a repeated generic narrative cannot choose a record by a cited ID');
 const conflict=matches.map(m=>({...m}));conflict.find(m=>m.fieldId==='sports-1').sourceId='club-body';
 conflict.find(m=>m.fieldId==='sports-1').value=resume.find(r=>r.fieldId==='club-body').value;
 worker.annotateAiSources(conflict,resume,fields);
 assert.ok(!Array.from(worker.guardResumeSources(conflict,fields,resume)).some(m=>m.fieldId==='sports-2'||m.fieldId==='sports-3'));
 const wrongPurpose=resume.map(r=>r.fieldId.endsWith('-body')?{...r,label:'兴趣爱好',key:r.recordId+'-兴趣爱好'}:r);
 worker.annotateAiSources(matches,wrongPurpose,fields);
 assert.ok(!Array.from(worker.guardResumeSources(matches,fields,wrongPurpose)).some(m=>/-[23]$/.test(m.fieldId)));
});

test('奖项级别的同义选项限定用途，重复与禁用等价项不猜测',()=>{
 const field={label:'获奖级别',group:'获奖经历'};
 assert.equal(ai.findSelectOptionIndex(['班组级','院校级','省区级','国家级'],'校级',field),1);
 assert.equal(ai.findSelectOptionIndex(['院校级','省区级'],'省级',field),1);
 assert.equal(ai.findSelectOptionIndex(['国家级'],'全国级',field),0);
 assert.equal(ai.findSelectOptionIndex(['院校级','学校级'],'校级',field),-1);
 assert.equal(ai.findSelectOptionIndex([{text:'院校级',disabled:true}],'校级',field),-1);
 assert.equal(ai.findSelectOptionIndex(['省区级'],'省级',{label:'其他信息'}),-1);
 assert.equal(ai.findSelectOptionIndex(['院系级'],'校级',field),-1);
 assert.equal(ai.findSelectOptionIndex(['国家级'],'校级',field),-1);
});

test('语言良好不换成熟练或精通，学历选项不越过学位与学历区别',()=>{
 const language={label:'听说',group:'语言能力'};
 assert.equal(ai.findSelectOptionIndex(['入门','熟练','精通','母语'],'良好',language),-1);
 assert.equal(ai.findSelectOptionIndex(['不良好'],'良好',language),-1);
 assert.equal(ai.findSelectOptionIndex([{text:'精通',value:'良好'}],'良好',language),-1);
 assert.equal(ai.findSelectOptionIndex(['良好','熟练'],'良好',language),0);
 assert.equal(ai.findSelectOptionIndex(['大学本科','硕士研究生'],'硕士',{label:'学历'}),1);
 assert.equal(ai.findSelectOptionIndex(['大学本科'],'学士',{label:'学历'}),-1);
 assert.equal(ai.findSelectOptionIndex(['博士后'],'博士',{label:'学历'}),-1);
});
