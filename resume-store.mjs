import './resume-tree.js';
import './collection-ai.js';
function mappingShape(templates) {
  return JSON.stringify((templates || []).map(t => globalThis.ResumeProTree.normalizeTemplate(t)).filter(Boolean).map(t => ({
    id:t.id, groups:t.groups.map(g => ({id:g.id,name:g.name,records:g.records,fields:g.fields.map(f => ({id:f.id,key:f.key,label:f.label,recordId:f.recordId}))}))
  })));
}

import { isSecretFieldName, isSecretFieldValue } from './link/secret-fields.mjs';

// One writer for the manager and page collection. Compare-and-set rejects stale editors.
export function installResumeStore(api) {
  let chain = Promise.resolve();
  api.runtime.onMessage.addListener((message, sender, reply) => {
    if (!['RESUME_COMMIT', 'RESUME_COLLECT', 'RESUME_REVIEW_CONTEXT', 'RESUME_REVIEW_SUGGEST'].includes(message?.type)) return false;
    const run = async () => {
      if (sender.id !== api.runtime.id) throw new Error('无法识别资料请求来源。');
      if (message.type === 'RESUME_COMMIT') {
        // Only the extension's own manager may replace stored data.
        if (sender.tab && !sender.url?.startsWith(api.runtime.getURL('popup.html'))) throw new Error('请在资料管理页保存更改。');
        const allowed = ['templates','activeTemplateId','aiConfig','profile','resumeImportDraft'];
        const keys = Object.keys(message.changes || {});
        if (keys.some(k => !allowed.includes(k))) throw new Error('未知存储字段。');
        const current = await api.storage.local.get(keys);
        for (const key of keys) {
          if (JSON.stringify(current[key]) !== JSON.stringify(message.expected?.[key])) throw new Error('资料已在其他页面更新。当前编辑内容已保留，请重新加载后再合并。');
        }
        if(keys.includes('resumeImportDraft')&&message.changes.resumeImportDraft!==null) {
          if(!message.changes.resumeImportDraft||typeof message.changes.resumeImportDraft!=='object')throw new Error('核对草稿格式无效。');
          message.changes.resumeImportDraft=globalThis.ResumeProTree.normalizeTemplate(message.changes.resumeImportDraft);
        }
        if (keys.includes('templates')) {
          if (!Array.isArray(message.changes.templates)) throw new Error('资料格式无效。');
          message.changes.templates = message.changes.templates.map(globalThis.ResumeProTree.normalizeTemplate).filter(Boolean);
          // A reordered/renamed record changes the meaning of old positional mappings.
          // Keep structural observations, but relearn mappings after structural edits.
          if (mappingShape(current.templates) !== mappingShape(message.changes.templates)) {
            const {formStructures} = await api.storage.local.get(['formStructures']);
            if (Array.isArray(formStructures)) message.changes.formStructures = formStructures.map(snapshot => ({...snapshot,
              fields: (snapshot.fields || []).map(field => ({...field,resumeKey:'',resumeGroup:'',hits:0,misses:0,groupSignature:''}))
            }));
          }
        }
        await api.storage.local.set(message.changes);
        return {success:true};
      }
      const stored = await api.storage.local.get(['templates']);
      const templates = (stored.templates || []).map(globalThis.ResumeProTree.normalizeTemplate).filter(Boolean);
      const template = templates.find(t => t.id === message.templateId);
      if (!template) throw new Error('资料已不存在，请重新选择。');
      const organizer = globalThis.ResumeProCollectionAI;
      if (message.type === 'RESUME_REVIEW_CONTEXT') {
        return {success:true,context:organizer.buildContext(template,message.ids,{isSecretFieldName,isSecretFieldValue})};
      }
      if (message.type === 'RESUME_REVIEW_SUGGEST') {
        if (!Array.isArray(message.context?.pending)) throw new Error('归纳上下文无效。');
        const context = organizer.buildContext(template,message.context.pending.map(p=>p.id),{isSecretFieldName,isSecretFieldValue});
        if (JSON.stringify(context)!==JSON.stringify(message.context)) throw new Error('归纳期间资料已变化，请重新归纳；原始内容已保留。');
        const suggestions = organizer.validateSuggestions(context,message.suggestions);
        for (const item of suggestions) template.pending.find(p=>p.id===item.id).suggestion=item.suggestion;
        await api.storage.local.set({templates});
        return {success:true,organized:suggestions.length};
      }
      const input = Array.isArray(message.fields) ? message.fields : [];
      if (input.length > 300) throw new Error('一次最多采集 300 个字段，请分批操作。');
      const safe = input.filter(f => f && !isSecretFieldName(`${f.group || ''} ${f.label || f.key}`) && !isSecretFieldValue(f.value) && !['password','hidden','file'].includes(f.inputType));
      const host = new URL(sender.url || sender.tab?.url).hostname;
      const candidates = globalThis.ResumeProTree.collectCandidates(template, safe, {kind:'web',host,capturedAt:new Date().toISOString()});
      for (const proposal of candidates) proposal.recordContext = safe.filter(f =>
        String(f.group || '').trim() === proposal.group && (Number(f.recordIndex)||0) === proposal.recordIndex
        && /学校|院校|公司|单位|项目名称|入学|毕业|开始时间|结束时间|学历|学位/.test(f.label || f.key || '')
      ).slice(0,8).map(f => ({key:String(f.label||f.key).slice(0,80),value:String(f.value||'').slice(0,500)}));
      if (template.pending.length + candidates.length > 500) throw new Error('待确认内容已满，请先在资料管理页处理。');
      template.pending.push(...candidates);
      await api.storage.local.set({templates});
      return {success:true, added:candidates.length, pending:template.pending.length, ids:candidates.map(p=>p.id)};
    };
    const task = chain.then(run, run);
    chain = task.catch(() => {});
    task.then(reply, error => reply({success:false,error:error.message}));
    return true;
  });
}
