const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const H=require('../ai-helpers'),S=require('../form-structure');
const w={importScripts(){},ResumeProAIHelpers:H,chrome:{runtime:{onMessage:{addListener(){}}}},AbortController,TextEncoder,performance,setTimeout,clearTimeout};
w.self=w;vm.createContext(w);vm.runInContext(fs.readFileSync(require.resolve('../ai-worker.js'),'utf8'),w);
const field=(id,label,datePart,role)=>({fieldId:id,label,group:'教育背景',recordIndex:1,recordSignature:'complete-record',...(datePart?{datePart,rangeRole:role}:{})});
const source=(id,recordId,label,value,group='教育经历')=>({fieldId:id,group,groupId:group,recordId,label,key:recordId+'-'+label,value});
const resume=[source('school-a','a','学校名称','示例大学'),source('major-a','a','专业','机械工程'),source('a-start','a','开始时间','2024-09'),source('a-end','a','结束时间','2027-06'),source('school-b','b','学校名称','示例大学'),source('major-b','b','专业','控制工程'),source('b-start','b','开始时间','2020-09'),source('b-end','b','结束时间','2024-06')];
test('split date values come from full dates and displayed options, never numeric substrings',()=>{
 assert.ok(H.isPlaceholderOption('年'));assert.ok(H.isPlaceholderOption('月'));assert.equal(H.isPlaceholderOption('9月'),false);
 assert.equal(H.datePartValue('2024年9月1日','month'),'09');assert.equal(H.datePartValue('2024-13-01','month'),'');assert.equal(H.datePartValue('2023-02-29','year'),'');
 assert.equal(H.findSelectOptionIndex([{text:'9月',value:'encoded-9'}],'09',{datePart:'month'}),0);
 assert.equal(H.findSelectOptionIndex(['9月','09月'],'09',{datePart:'month'}),-1);
 assert.equal(H.findSelectOptionIndex([{text:'10月',value:'09'}],'09',{datePart:'month'}),-1);
 assert.equal(H.findSelectOptionIndex(['月','0月','13月'],'09',{datePart:'month'}),-1);
 assert.equal(H.isValueValidForField({datePart:'year',label:'出生日期',options:['2002年']},'2002'),true);
 const f=field('year','开始时间','year','start');
 assert.equal(H.findResumeSource('2024',[source('phone','a','电话','13820240000')],f).relation,'none');
 assert.equal(H.findResumeSource('2027',[resume[3]],f).relation,'none');
 assert.equal(H.findResumeSource('2024',[resume[2]],f).relation,'date-part');
 assert.equal(H.findResumeSource('2024',[resume[2]],{...f,dateRangeUnresolved:true}).relation,'none');
 const unclear={...f,dateRangeUnresolved:true},proposal={fieldId:'year',value:'2024',sourceId:'a-start'},rejections=[];
 w.annotateAiSources([proposal],resume,[unclear]);assert.equal(w.guardResumeSources([proposal],[unclear],resume,rejections).length,0);assert.match(rejections[0].reason,/起止方向/);
});
test('all four date parts bind to the named education record and missing parts have local fallback',()=>{
 const fields=[field('school','学校名称'),field('major','专业名称'),field('sy','开始时间','year','start'),field('sm','开始时间','month','start'),field('ey','结束时间','year','end'),field('em','结束时间','month','end')];
 const matches=[{fieldId:'school',value:'示例大学',sourceId:'school-a'},{fieldId:'major',value:'机械工程',sourceId:'major-a'},{fieldId:'sm',value:'09'}];
 w.annotateAiSources(matches,resume,fields);assert.equal(matches[2].resumeRecordId,'a');
 const safe=w.guardResumeSources(matches,fields,resume);assert.equal(safe.length,3);
 const fallback=Array.from(w.buildRecordFactMatches(fields,resume,safe));
 assert.deepEqual(fallback.map(match=>[match.fieldId,match.value,match.resumeRecordId]),[['sy','2024','a'],['ey','2027','a'],['em','06','a']]);
 for(const bad of [{fieldId:'sy',value:'2020',sourceId:'b-start'},{fieldId:'sy',value:'2027',sourceId:'a-end'}]){
  const check=[matches[0],matches[1],bad],rejections=[];w.annotateAiSources(check,resume,fields);assert.ok(!w.guardResumeSources(check,fields,resume,rejections).includes(bad));assert.equal(rejections.length,1);
 }
});
test('a partial year-list observation cannot discard a sourced modern year',()=>{
 const partial=Array.from({length:60},(_,i)=>String(1900+i)+'年');
 const fields=[field('school','学校名称'),field('major','专业名称'),
  {...field('sy','开始时间','year','start'),inputType:'combobox',options:partial,optionsComplete:false}];
 const matches=[{fieldId:'school',value:'示例大学',sourceId:'school-a'},{fieldId:'major',value:'机械工程',sourceId:'major-a'}];
 w.annotateAiSources(matches,resume,fields);
 assert.equal(H.isValueValidForField(fields[2],'2024'),true);
 const fallback=Array.from(w.buildRecordFactMatches(fields,resume,matches));
 assert.deepEqual(fallback.map(m=>[m.fieldId,m.value,m.resumeRecordId]),[['sy','2024','a']]);
 assert.equal(H.isValueValidForField({...fields[2],optionsComplete:true},'2024'),false);
 assert.equal(H.isValueValidForField({...fields[2],datePart:'month'},'13'),false);
});
test('award name alias resolves year/month sources; actual internship still rejects project sources',()=>{
 const r=[source('award','award','获奖名称','示例奖学金','获奖经历'),source('date','award','获奖时间','2022-12','获奖经历')];
 const f=[{...field('name','奖项名称'),group:'获奖经历'},{...field('year','获奖时间','year'),group:'获奖经历'},{...field('month','获奖时间','month'),group:'获奖经历'}];
 const matches=[{fieldId:'name',value:'示例奖学金',sourceId:'award'}];w.annotateAiSources(matches,r,f);
 assert.deepEqual(Array.from(w.buildRecordFactMatches(f,r,matches),m=>[m.value,m.resumeRecordId]),[['2022','award'],['12','award']]);
 const p=[source('p','project','项目名称','科研项目','项目经历')],page=[{fieldId:'p',label:'项目名称',group:'实习经历'}],wrong=[{fieldId:'p',value:'科研项目',sourceId:'p'}];
 w.annotateAiSources(wrong,p,page);assert.equal(w.guardResumeSources(wrong,page,p).length,0);
});
test('year and month retain separate snapshot identities while old full date identities stay compatible',()=>{
 const year={group:'教育背景',recordIndex:1,label:'开始时间',datePart:'year'},month={...year,datePart:'month'};
 const fields=S.mergeFields([], [year,month]);assert.equal(fields.length,2);
 assert.notEqual(S.fieldIdentity(year),S.fieldIdentity(month));
 assert.equal(S.fieldIdentity({...year,datePart:undefined}),JSON.stringify(['教育背景',1,'开始时间']));
 const restored=JSON.parse(S.serialize([{fields}])).snapshots[0].fields;assert.deepEqual(restored.map(f=>f.datePart),['year','month']);
});
test('split birthday follows the same full-date person guard, not a family member or graduation year',()=>{
 const fields=[{fieldId:'year',label:'出生日期',group:'个人信息',datePart:'year',inputType:'select',options:['年','2002年','2003年']}];
 const dates=[source('birth','self','出生日期','2002-03-15','个人信息'),source('father','father','出生日期','2002-09-08','父亲'),source('graduation','edu','毕业时间','2003-06','教育经历')];
 assert.equal(H.findResumeSource('2002',dates,fields[0]).field.fieldId,'birth');
 assert.equal(w.plausibleContactSource({fieldId:'year',value:'2002'},fields,dates),true);
 assert.equal(w.plausibleContactSource({fieldId:'year',value:'2003'},fields,dates),false);
 assert.equal(w.plausibleContactSource({fieldId:'year',value:'2002'},fields,dates.slice(1)),false);
});
