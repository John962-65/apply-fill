/* AI proposes organization only. Original captured values remain authoritative until review. */
(function(root) {
  const text=(v,n=160)=>String(v??'').trim().slice(0,n);
  function normalizeSuggestion(s) {
    if(!s||typeof s!=='object')return null;
    return {action:['add','update','duplicate','uncertain'].includes(s.action)?s.action:'uncertain',recordId:text(s.recordId,300),fieldId:text(s.fieldId,300),label:text(s.label,80),groupName:text(s.groupName,80),recordName:text(s.recordName,150),summary:text(s.summary,600),reason:text(s.reason,300)};
  }
  function buildContext(template, ids, secret={}) {
    const safe=(key,value)=>!secret.isSecretFieldName?.(key)&&!secret.isSecretFieldValue?.(value);
    const wanted=Array.isArray(ids)?new Set(ids):null;
    const pending=(wanted?ids.map(id=>template.pending.find(p=>p.id===id)).filter(Boolean):template.pending).filter(p=>safe(`${p.group} ${p.key}`,p.value));
    const selected=(wanted?pending:[...pending.filter(p=>!p.suggestion),...pending.filter(p=>p.suggestion)]).slice(0,50);
    const records=template.groups.filter(g=>safe(g.name,'')).flatMap(g=>g.records.filter(r=>safe(r.name,'')).map(r=>({
      groupName:g.name,recordId:r.id,recordName:r.name,fields:g.fields.filter(f=>f.recordId===r.id&&safe(f.label+' '+f.key,f.value)).map(f=>({fieldId:f.id,label:f.label,value:f.value.slice(0,2000)}))
    }))).slice(0,200);
    return {templateId:template.id,records,pending:selected.map(p=>({id:p.id,key:p.key,value:p.value,group:p.group,recordIndex:p.recordIndex,recordContext:(p.recordContext||[]).filter(f=>safe(f.key,f.value))}))};
  }
  function validateSuggestions(context, payload) {
    if(!Array.isArray(payload))throw new Error('AI 归纳格式无效，原始采集内容已保留。');
    const result=[];
    for(const p of context.pending) {
      const candidates=payload.filter(s=>s?.id===p.id);
      if(candidates.length!==1)continue;
      const suggestion=normalizeSuggestion(candidates[0]);
      const target=context.records.find(r=>r.recordId===suggestion.recordId);
      const field=target?.fields.find(f=>f.fieldId===suggestion.fieldId);
      if((suggestion.recordId&&!target)||(suggestion.fieldId&&!field)||(['update','duplicate'].includes(suggestion.action)&&!field)) {
        suggestion.action='uncertain';suggestion.recordId='';suggestion.fieldId='';suggestion.reason='归属无法核实，请手动选择。';
      }
      if(suggestion.action==='duplicate'&&field?.value!==p.value){suggestion.action='update';suggestion.reason='与已有内容不同，请核对新旧内容。';}
      if(suggestion.action==='uncertain'){suggestion.recordId='';suggestion.fieldId='';}
      // Short factual fields do not benefit from a generated summary.
      if(p.value.length<100||/手机|电话|邮箱|出生|生日|证件|身份证|日期|时间/.test(p.key))suggestion.summary='';
      result.push({id:p.id,suggestion});
    }
    return result;
  }
  async function organize(templateId, ids, {signal,onProgress} = {}) {
    const stopped = () => new Error('已停止等待 AI 归纳，原始内容已保留。停止等待不保证模型接口停止计算或计费。');
    const checkStopped = () => {if(signal?.aborted)throw stopped();};
    checkStopped();
    const prepared=await root.chrome.runtime.sendMessage({type:'RESUME_REVIEW_CONTEXT',templateId,ids});
    checkStopped();
    if(!prepared?.success)throw new Error(prepared?.error||'无法读取补充内容。');
    if(!prepared.context.pending.length)return {success:true,organized:0};
    const {aiConfig}=await root.chrome.storage.local.get(['aiConfig']);
    checkStopped();
    if(!aiConfig?.apiUrl||!aiConfig?.apiKey||!aiConfig?.model)throw new Error('尚未配置 AI，原始采集内容已保留，可手动归类。');
    const requestId=root.crypto.randomUUID(),started=Date.now();
    let cancelListener,timer;
    try {
      // send registers the request before awaiting host startup, so cancel can also wait for posting.
      const request=root.ResumeProAIClient.send({type:'AI_ORGANIZE_COLLECTION',requestId,aiConfig,context:prepared.context});
      const cancellation=new Promise((resolve,reject)=>{
        cancelListener=()=>{
          root.ResumeProAIClient.cancel(requestId).catch(()=>{});
          reject(stopped());
        };
        signal?.addEventListener('abort',cancelListener,{once:true});
        if(signal?.aborted)cancelListener();
      });
      const progress=()=>onProgress?.(Math.floor((Date.now()-started)/1000));
      progress();
      if(onProgress)timer=root.setInterval(progress,1000);
      const response=await Promise.race([request,cancellation]);
      checkStopped();
      if(!response?.success)throw new Error(response?.error||'AI 归纳未完成，原始采集内容已保留。');
      const saved=await root.chrome.runtime.sendMessage({type:'RESUME_REVIEW_SUGGEST',templateId,context:prepared.context,suggestions:response.suggestions});
      if(!saved?.success)throw new Error(saved?.error||'无法保存归纳建议。');
      return saved;
    } finally {
      if(timer!==undefined)root.clearInterval(timer);
      signal?.removeEventListener('abort',cancelListener);
    }
  }
  root.ResumeProCollectionAI={normalizeSuggestion,buildContext,validateSuggestions,organize};
  if(typeof module!=='undefined')module.exports=root.ResumeProCollectionAI;
})(typeof self!=='undefined'?self:globalThis);
