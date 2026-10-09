const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const H=require('../ai-helpers'),I=require('../resume-import'),T=require('../resume-tree');
const w={importScripts(){},ResumeProAIHelpers:H,chrome:{runtime:{onMessage:{addListener(){}}}},AbortController,TextEncoder,performance,setTimeout,clearTimeout};
w.self=w;vm.createContext(w);vm.runInContext(fs.readFileSync(require.resolve('../ai-worker.js'),'utf8'),w);
const source=(fieldId,recordId,label,value,group='教育经历')=>({fieldId,recordId,label,key:recordId+'-'+label,value,group});
const page=(fieldId,label,recordIndex=1,group='教育经历',inputType='combobox')=>({fieldId,label,recordIndex,group,inputType});
const check=(matches,fields,resume)=>{w.annotateAiSources(matches,resume,fields);return Array.from(w.guardResumeSources(matches,fields,resume));};

test('获奖描述可组合本条明确级别和等级；漏匹配时本地补充，不新增事实',()=>{
 const group='获奖经历',resume=[source('name','a','获奖名称','匿名奖学金',group),source('level','a','奖项级别','校级',group),source('grade','a','获奖等级','一等奖',group)];
 const fields=[page('name','获奖名称',1,group,'text'),page('body','描述',1,group,'textarea')];
 const anchors=[{fieldId:'name',value:'匿名奖学金',sourceId:'name'}];
 const matches=check([...anchors,{fieldId:'body',value:'奖项级别：校级；获奖等级：一等奖',sourceIds:['level','grade']}],fields,resume);
 assert.equal(matches.length,2);assert.equal(matches[1].relation,'composed');assert.equal(matches[1].resumeRecordId,'a');
 assert.deepEqual(Array.from(matches[1].sourceIds),['level','grade']);
 const local=Array.from(w.buildRecordNarrativeMatches(fields,resume,check(anchors,fields,resume)));
 assert.equal(local.length,1);assert.equal(local[0].value,'奖项级别：校级；获奖等级：一等奖');
 assert.equal(resume.length,3);
 for(const extra of [source('other','b','获奖等级','一等奖',group),source('conflict','a','获奖等级','二等奖',group)]){
  const citation=extra.recordId==='b'?['level','other']:['level','grade','conflict'];
  assert.equal(check([...anchors,{fieldId:'body',value:'奖项级别：校级；获奖等级：一等奖',sourceIds:citation}],fields,[...resume,extra]).length,1);
 }
 assert.equal(check([...anchors,{fieldId:'body',value:'奖项级别：国家级；获奖等级：一等奖',sourceIds:['level','grade']}],fields,resume).length,1);
 const missing=resume.filter(r=>r.fieldId!=='grade'),limited=Array.from(w.buildRecordNarrativeMatches(fields,missing,check(anchors,fields,missing)));
 assert.equal(limited[0].value,'奖项级别：校级');
 assert.equal(H.inferFieldSemantic({label:'手机区号'}),'');
 assert.equal(H.isValueValidForField({label:'手机区号'},'15282210000'),false);
});

test('旧资料学历学士及工学学士原文推导本科，来源仍指向本条原字段',()=>{
 const resume=[source('s','b','学校名称','示例大学'),source('l','b','学历','学士'),source('d','b','学位','工学学士')];
 const fields=[page('school','学校名称'),{...page('level','学历'),inputType:'select',options:['请选择','大学本科','硕士研究生']}];
 for(const citation of [{sourceId:'l'},{sourceId:'d'},{sourceIds:['l','d']},{}]){
  const matches=[{fieldId:'school',value:'示例大学',sourceId:'s'},{fieldId:'level',value:'学士',...citation}];
  const kept=check(matches,fields,resume),level=kept.find(m=>m.fieldId==='level');
  assert.ok(level);assert.equal(level.value,'本科');assert.equal(level.relation,'inferred');assert.equal(level.resumeRecordId,'b');
  assert.equal(level.inference.targetValue,'本科');assert.equal(H.filterValidMatches(fields,kept).length,2);
 }
 assert.deepEqual(resume.map(r=>r.value),['示例大学','学士','工学学士'],'runtime conversion never mutates the tree');
});

test('学科限定学位可匹配普通学位；学历推导不使用荣誉、在读、证书或全局学位',()=>{
 assert.equal(H.findResumeSource('学士',[source('d','b','学位','工学学士')],{label:'学位'}).relation,'equivalent');
 assert.equal(H.findResumeSource('本科',[source('d','b','学士学位','工学学士')],{label:'学历'}).relation,'inferred','legacy stage-prefixed degree is explicit evidence');
 assert.equal(H.findResumeSource('硕士研究生',[source('d','m','学位','理学硕士')],{label:'学历'}).relation,'inferred');
 for(const degree of ['荣誉学士','名誉博士','博士后','硕士在读','学士肄业','同等学力']){
  assert.equal(H.findResumeSource('本科',[source('d','b','学位',degree)],{label:'学历'}).relation,'none',degree);
 }
 for(const group of ['基本信息','资格证书','家庭成员'])assert.equal(H.findResumeSource('本科',[source('d','b','学位','学士',group)],{label:'学历'}).relation,'none');
 assert.equal(H.findResumeSource('学士',[source('l','b','学历','本科')],{label:'学位'}).relation,'none','education never invents a conferred degree');
});

test('已绑定学校的学历推导不跨行，并与明确学历冲突时停止',()=>{
 const resume=[source('s1','b','学校名称','同校'),source('s2','m','学校名称','同校'),source('d1','b','学位','学士'),source('d2','m','学位','工学硕士')];
 const fields=[page('s1','学校名称',1),page('s2','学校名称',2),page('level','学历',1)];
 const anchors=[{fieldId:'s1',value:'同校',sourceId:'s1'},{fieldId:'s2',value:'同校',sourceId:'s2'}];
 assert.ok(!check([...anchors,{fieldId:'level',value:'硕士',sourceId:'d2'}],fields,resume).some(m=>m.fieldId==='level'));
 const rejections=[],matches=[...anchors,{fieldId:'level',value:'本科',sourceId:'d1'}],conflict=[...resume,source('explicit','b','学历','大专')];
 w.annotateAiSources(matches,conflict,fields);w.guardResumeSources(matches,fields,conflict,rejections);
 assert.ok(rejections.some(r=>r.fieldId==='level'&&/冲突/.test(r.reason)));
 const conflictingDegrees=[...resume,source('second-degree','b','学位','硕士')];
 assert.ok(!check([...anchors,{fieldId:'level',value:'本科',sourceId:'d1'}],fields,conflictingDegrees).some(m=>m.fieldId==='level'));
});

test('学校同名时由唯一专业建立记录，漏出的本科层次可本地推导',()=>{
 const resume=[source('s1','b','学校名称','同校'),source('p1','b','专业','交通工程'),source('d1','b','学位','工学学士'),
  source('s2','m','学校名称','同校'),source('p2','m','专业','机械工程'),source('d2','m','学位','工学硕士')];
 const fields=[page('school','学校名称'),page('major','专业名称'),page('level','学历')];
 const matches=[{fieldId:'school',value:'同校'},{fieldId:'major',value:'交通工程',sourceId:'p1'}];
 const kept=check(matches,fields,resume);assert.equal(kept.length,2);assert.equal(kept[0].resumeRecordId,'b');
 const fallback=Array.from(w.buildRecordFactMatches(fields,resume,kept));assert.equal(fallback.length,1);assert.equal(fallback[0].value,'本科');
});

test('同值校园职务和日期按独立描述归属，未声明来源的重复事实可复用；错误显式来源不替换',()=>{
 const group='校园经历',fields=['职务名称','职务描述','开始时间'].map((label,i)=>page('p'+i,label,1,group,'text'));
 const resume=['club','sports'].flatMap((r,i)=>[source(r+'role',r,'担任职务','干事',group),source(r+'body',r,'经历描述',i?'组织球类比赛。':'策划社团活动。',group),source(r+'date',r,'开始时间','2020-09',group)]);
 resume.push({...resume[0],fieldId:'copy-role'});
 const matches=[{fieldId:'p0',value:'干事'},{fieldId:'p1',value:'策划社团活动。',sourceId:'clubbody'},{fieldId:'p2',value:'2020-09'}];
 const kept=check(matches,fields,resume);assert.equal(kept.length,3);assert.ok(kept.every(m=>m.resumeRecordId==='club'));
 const wrong=matches.map(m=>({fieldId:m.fieldId,value:m.value,...(m.fieldId==='p2'?{sourceId:'sportsdate'}:m.sourceId?{sourceId:m.sourceId}:{})}));
 assert.ok(!check(wrong,fields,resume).some(m=>m.fieldId==='p2'));
 assert.equal(check([{fieldId:'p0',value:'干事'},{fieldId:'p2',value:'2020-09'}],fields,resume).length,0);
});

test('已确认获奖记录可补原级别和日期，模型同义写法可通过来源验证',()=>{
 const group='获奖经历',resume=[source('name','a','获奖名称','示例奖学金',group),source('level','a','获奖级别','校级',group),source('date','a','获奖时间','2024-09',group),source('other','b','获奖级别','国家级',group)];
 const fields=[page('name','获奖名称',1,group,'text'),page('level','获奖级别',1,group),page('date','获奖时间',1,group)];
 const named=check([{fieldId:'name',value:'示例奖学金',sourceId:'name'}],fields,resume);
 assert.deepEqual(Array.from(w.buildRecordFactMatches(fields,resume,named),m=>[m.fieldId,m.value]),[['level','校级'],['date','2024-09']]);
 const kept=check([{fieldId:'name',value:'示例奖学金',sourceId:'name'},{fieldId:'level',value:'院校级',sourceId:'level'}],fields,resume);
 assert.equal(kept.length,2);assert.equal(kept[1].relation,'equivalent');
 assert.ok(!check([{fieldId:'name',value:'示例奖学金',sourceId:'name'},{fieldId:'level',value:'国家级',sourceId:'other'}],fields,resume).some(m=>m.fieldId==='level'));
});

test('阅读与写作同水平可组合读写并保留两项依据；不同水平、只有一项、跨语种不推导',()=>{
 const group='语言能力',fields=[page('lang','语言类型',1,group),page('rw','读写',1,group)];
 const resume=[source('lang','en','语言','英语',group),source('read','en','阅读能力','良好',group),source('write','en','写作能力','良好',group)];
 const named=check([{fieldId:'lang',value:'英语',sourceId:'lang'}],fields,resume);
 const fallback=Array.from(w.buildRecordFactMatches(fields,resume,named));assert.equal(fallback.length,1);assert.equal(fallback[0].value,'良好');assert.equal(fallback[0].relation,'inferred');
 assert.deepEqual(Array.from(fallback[0].sourceIds),['read','write']);
 assert.equal(check([...named,{fieldId:'rw',value:'良好',sourceIds:['read','write']}],fields,resume).length,2);
 for(const variant of [resume.slice(0,2),resume.map(s=>s.fieldId==='write'?{...s,value:'一般'}:s),resume.map(s=>s.fieldId==='write'?{...s,recordId:'jp'}:s)]){
  assert.equal(w.buildRecordFactMatches(fields,variant,named).length,0);
  assert.ok(!check([...named,{fieldId:'rw',value:'良好',sourceIds:['read','write']}],fields,variant).some(m=>m.fieldId==='rw'));
 }
 assert.equal(H.findSelectOptionIndex(['入门','熟练','精通','母语'],'良好',fields[1]),-1,'combining evidence does not change the actual level');
});

test('同条本人重复联系方式可使用，相同号码跨联系人或记录仍不混用',()=>{
 const fields=[{fieldId:'phone',label:'手机号码',group:'个人信息',inputType:'text'}];
 const resume=[source('p1','me','手机','13800000000','个人信息'),source('p2','me','电话','13800000000','个人信息')];
 assert.equal(w.plausibleContactSource({fieldId:'phone',value:'13800000000'},fields,resume),true);
 const annotated=[{fieldId:'phone',value:'13800000000'}],copies=resume.map((s,i)=>i?{...s,value:s.value+'（微信同号）'}:s);
 assert.equal(check(annotated,fields,copies).length,1);
 assert.equal(w.plausibleContactSource({fieldId:'phone',value:'13800000000'},fields,resume.map((s,i)=>({...s,recordId:'person'+i}))),false);
 assert.equal(w.plausibleContactSource({fieldId:'phone',value:'13800000000'},fields,[source('qq','me','QQ','13800000000','个人信息')]),false);
});

test('下拉存在唯一原文项时优先选原文，再作同义转换；重复实际项仍停止',()=>{
 assert.equal(H.findSelectOptionIndex(['院校级','校级'],'校级',{label:'获奖级别'}),1);
 assert.equal(H.findSelectOptionIndex(['学士','工学学士'],'工学学士',{label:'学位'}),1);
 assert.equal(H.findSelectOptionIndex(['校级','校级'],'校级',{label:'获奖级别'}),-1);
});

test('上传只依据本条可核对学位产生学历草稿，保留原文、推导和待确认状态',()=>{
 const parse=(fields,text)=>I.normalizeExtraction({sections:[{id:'education',records:[{name:'示例大学',fields}]}]},text);
 const degree={label:'学位',value:'工学学士',evidence:'授予工学学士学位'};
 const e=parse([degree],'授予工学学士学位'),draft=I.createDraft(e,{id:'inference-draft'});
 const level=draft.groups.find(g=>g.name==='教育经历').fields.find(f=>f.label==='学历');
 assert.equal(level.value,'本科');assert.equal(level.source.verified,true);assert.equal(level.review.status,'pending');assert.equal(level.source.inference.inputValue,'工学学士');
 assert.deepEqual(T.normalizeTemplate(draft),draft);
 assert.throws(()=>I.completeReview(draft),/待核对/);
 const modelDerived=parse([degree,{label:'学历',value:'本科',evidence:'授予工学学士学位'}],'授予工学学士学位');
 assert.equal(modelDerived.sections[0].records[0].fields.find(f=>f.label==='学历').verified,true);
 for(const [value,text] of [['工学学士','没有授予学位'],['荣誉学士','授予荣誉学士学位']]){
  assert.ok(!parse([{...degree,value,evidence:'授予'+value+'学位'}],text).sections[0].records[0].fields.some(f=>f.label==='学历'));
 }
 const raw=parse([{label:'学历',value:'学士',evidence:'学历：学士'}],'学历：学士').sections[0].records[0].fields[0];
 assert.equal(raw.value,'学士');assert.equal(raw.inference.targetValue,'本科');
});
