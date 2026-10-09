const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const H=require('../ai-helpers');
function worker(){const w={importScripts(){},ResumeProAIHelpers:H,AbortController,TextEncoder,performance,setTimeout,clearTimeout};w.self=w;vm.createContext(w);vm.runInContext(fs.readFileSync(require.resolve('../ai-worker.js'),'utf8'),w);return w;}
function fixture(){
 const resume=[['a','匿名机械臂项目','2026-01','2026-09'],['b','匿名压缩机项目','2025-03','2025-07']].flatMap(([recordId,name,start,end])=>
  [['name','项目名称',name],['start','开始时间',start],['end','结束时间',end],['body','项目描述',name+'完成独立验证与结果分析。']].map(([suffix,label,value])=>({fieldId:recordId+'-'+suffix,recordId,group:'项目经历',label,key:recordId+'-'+label,value})));
 const fields=[{fieldId:'name',label:'项目名称',currentValue:'匿名机械臂项目'},
  ...[['sy','start','year'],['sm','start','month'],['ey','end','year'],['em','end','month']].map(([fieldId,rangeRole,datePart])=>({fieldId,label:'起止时间',rangeRole,datePart,rangeId:'range'}))]
  .map(f=>({...f,group:'项目经历',recordIndex:1,recordSignature:'page-row'}));
 const wrong=[{fieldId:'name',value:'匿名压缩机项目',sourceId:'b-name'},...fields.filter(f=>f.datePart).map(f=>({fieldId:f.fieldId,value:H.datePartValue(resume.find(r=>r.fieldId==='b-'+f.rangeRole).value,f.datePart),sourceId:'b-'+f.rangeRole}))];
 return {resume,fields,wrong};
}
test('已有项目名称优先于 AI 提议的另一条记录，重建自己的日期',()=>{
 const w=worker(),{resume,fields,wrong}=fixture();w.annotateAiSources(wrong,resume,fields);
 const rejected=[],kept=w.guardResumeSources(wrong,fields,resume,rejected);
 assert.equal(kept.length,0);assert.equal(rejected.length,5);
 const facts=Array.from(w.buildRecordFactMatches(fields,resume,kept));
 assert.deepEqual(facts.map(m=>[m.fieldId,m.value,m.resumeRecordId]),[['name','匿名机械臂项目','a'],['sy','2026','a'],['sm','01','a'],['ey','2026','a'],['em','09','a']]);
});
test('已有名称不在资料里、多个候选或与已有描述冲突时不借用 AI 的记录',()=>{
 for(const mode of ['unknown','duplicate','conflict']){
  const w=worker(),{resume,fields,wrong}=fixture();
  if(mode==='unknown')fields[0].currentValue='人工新建未归档项目';
  if(mode==='duplicate')resume.find(r=>r.fieldId==='b-name').value=fields[0].currentValue;
  if(mode==='conflict')fields.push({...fields[0],fieldId:'body',label:'项目描述',currentValue:resume.find(r=>r.fieldId==='b-body').value});
  w.annotateAiSources(wrong,resume,fields);const kept=w.guardResumeSources(wrong,fields,resume);
  assert.ok(!kept.some(m=>m.fieldId!=='name'),mode);
  assert.equal(w.buildRecordFactMatches(fields,resume,kept).length,0,mode);
 }
});
test('同校多段教育用网页已有专业交叉确认，不按学校名或位置复用',()=>{
 const w=worker(),resume=[['masters','机械工程','2024-09'],['bachelors','控制工程','2020-09']].flatMap(([recordId,major,date])=>[
  {fieldId:recordId+'-school',group:'教育经历',recordId,label:'学校名称',key:'学校名称',value:'匿名大学'},
  {fieldId:recordId+'-major',group:'教育经历',recordId,label:'专业',key:'专业',value:major},
  {fieldId:recordId+'-start',group:'教育经历',recordId,label:'开始时间',key:'开始时间',value:date}]);
 const fields=[{fieldId:'school',label:'学校名称',currentValue:'匿名大学'},{fieldId:'major',label:'专业名称',currentValue:'控制工程'},
  {fieldId:'year',label:'开始时间',datePart:'year',rangeRole:'start'}].map(f=>({...f,group:'教育背景',recordIndex:1}));
 const facts=Array.from(w.buildRecordFactMatches(fields,resume,[]));
 assert.equal(facts.find(m=>m.fieldId==='year').value,'2020');assert.ok(facts.every(m=>m.resumeRecordId==='bachelors'));
});
test('重复奖项名称用已经选中的年月区分，未确认搜索词不参与绑定',()=>{
 const w=worker(),resume=['2024-09','2025-09'].flatMap((value,n)=>[
  {fieldId:'award-name-'+n,group:'获奖经历',recordId:'a'+n,label:'获奖名称',key:'获奖名称',value:'匿名学业奖学金'},
  {fieldId:'award-time-'+n,group:'获奖经历',recordId:'a'+n,label:'获奖时间',key:'获奖时间',value}]);
 const fields=[{fieldId:'name',label:'奖项名称',currentValue:'匿名学业奖学金'},{fieldId:'year',label:'获奖时间',datePart:'year',currentValue:'2025年'},
  {fieldId:'month',label:'获奖时间',datePart:'month'}].map(f=>({...f,group:'获奖经历',recordIndex:1}));
 const facts=Array.from(w.buildRecordFactMatches(fields,resume,[]));assert.ok(facts.every(m=>m.resumeRecordId==='a1'));assert.equal(facts.find(m=>m.fieldId==='month').value,'09');
 delete fields[1].currentValue;assert.equal(w.buildRecordFactMatches(fields,resume,[]).length,0);
});
