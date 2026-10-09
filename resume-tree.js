/* Canonical resume data stays compatible with the existing groups/fields fill API.
 * Records, field IDs and review metadata are persisted alongside those fields. */
(function (root) {
  const VERSION = 1;
  const uid = () => root.crypto.randomUUID();
  const str = value => String(value ?? '').trim();
  const repeatGroup = name => /教育|工作|实习|项目|科研|校园|在校|校内职务|社团经历|社会实践|论文|专利|证书|奖励|获奖|荣誉|语言|外语|技能|职业资格|家庭|联系人/.test(name);
  function inferRecord(key, groupName) {
    if (!repeatGroup(groupName)) return { bucket: 'default', name: '基本资料', label: key };
    const numbered = key.match(/^(教育经历|教育背景|教育|工作经历|工作|实习经历|实习|项目经历|项目|科研经历|科研|校园经历|校园|在校职务|校内职务|在校经历|社团经历|社会实践|论文|专利|资格证书|证书|获奖经历|获奖|奖励|语言考试|语言能力|语言|专业技能|技能|家庭成员|紧急联系人)(\d+)(.+)$/);
    if (numbered) return { bucket: `number:${numbered[1]}:${numbered[2]}`, name: `${numbered[1]} ${numbered[2]}`, label: numbered[3] };
    const suffix = key.match(/^(学校|院校|专业|学历|学位|入学时间|毕业时间|开始时间|结束时间|起止时间|公司|单位|岗位|职位|项目名称|项目时间|获奖名称|获奖时间|获奖描述|考试名称|考试成绩|考试时间|语言|掌握程度|证书名称|取得时间|描述|职责)([1-9]\d*)$/);
    if (suffix) return { bucket: `number:${suffix[2]}`, name: `${groupName} ${suffix[2]}`, label: suffix[1] };
    // The previous parser emitted “学校教育经历-专业 (2)”. Keep its occurrence suffix.
    const anchor = key.match(/^(.+?)-(.+?)(?: \((\d+)\))?$/);
    if (anchor) return { bucket: `anchor:${anchor[1]}:${anchor[3] || '1'}`, name: `${anchor[1]}${anchor[3] ? ` (${anchor[3]})` : ''}`, label: anchor[2] };
    return { bucket: 'default', name: '待归类资料', label: key };
  }
  function normalizeTemplate(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const templateId = str(raw.id) || uid();
    const ids = new Set([templateId]);
    function identity(candidate, fallback) {
      let id = str(candidate) || fallback;
      if (ids.has(id)) id = fallback;
      while (ids.has(id)) id += '_';
      ids.add(id); return id;
    }
    const groups = (Array.isArray(raw.groups) ? raw.groups : []).filter(g => g && typeof g === 'object').map((g, gi) => {
      const id = identity(g.id, `${templateId}:g:${gi}`);
      const name = str(g.name) || '未分类';
      const records = (Array.isArray(g.records) ? g.records : []).filter(r => r && typeof r === 'object').map((r, ri) => ({
        id: identity(r.id, `${id}:r:${ri}`), name: str(r.name) || '未命名经历'
      }));
      const recordIds = new Set(records.map(r => r.id));
      const buckets = new Map();
      const fields = (Array.isArray(g.fields) ? g.fields : []).filter(f => f && str(f.key)).map((f, fi) => {
        let recordId = str(f.recordId);
        let label = str(f.label) || str(f.key);
        if (!recordIds.has(recordId)) {
          const inferred = inferRecord(str(f.key), name);
          if (!buckets.has(inferred.bucket)) {
            const record = { id: identity('', `${id}:r:${records.length}`), name: inferred.name };
            records.push(record); recordIds.add(record.id); buckets.set(inferred.bucket, record.id);
          }
          recordId = buckets.get(inferred.bucket); label = inferred.label;
        }
        return { id: identity(f.id, `${id}:f:${fi}`), key: str(f.key), label, value: String(f.value ?? ''), recordId,
          ...(f.source && typeof f.source === 'object' ? {source: normalizeSource(f.source)} : {}),
          ...(f.review && ['pending','confirmed'].includes(f.review.status) ? {review:{status:f.review.status,reason:str(f.review.reason),...(f.review.edited?{edited:true}:{})}} : {}) };
      });
      return { id, name, records, fields };
    });
    return { id: templateId, name: str(raw.name) || '未命名资料', treeVersion: VERSION, groups,
      ...(raw.importReview && ['pending','confirmed'].includes(raw.importReview.status)?{importReview:{
        schemaVersion:1,status:raw.importReview.status,fileName:str(raw.importReview.fileName),createdAt:str(raw.importReview.createdAt),
        ...(raw.importReview.confirmedAt?{confirmedAt:str(raw.importReview.confirmedAt)}:{}),
        warnings:(Array.isArray(raw.importReview.warnings)?raw.importReview.warnings:[]).map(str).filter(Boolean)
      }}:{}),
      pending: (Array.isArray(raw.pending) ? raw.pending : []).filter(p => p && str(p.key)).map((p, pi) => ({
        id: identity(p.id, `${templateId}:pending:${pi}`), key: str(p.key), value: String(p.value ?? ''),
        group: str(p.group), recordIndex: Number(p.recordIndex) || 0, source: normalizeSource(p.source),
        ...(Array.isArray(p.recordContext)?{recordContext:p.recordContext.slice(0,8).map(f=>({key:str(f?.key).slice(0,80),value:String(f?.value??'').slice(0,500)}))}:{}),
        ...(root.ResumeProCollectionAI?.normalizeSuggestion(p.suggestion) ? {suggestion:root.ResumeProCollectionAI.normalizeSuggestion(p.suggestion)} : {})
      })) };
  }
  function normalizeSource(source = {}) {
    return { kind: ['web', 'manual', 'import','resume'].includes(source.kind) ? source.kind : 'import',
      host: str(source.host), capturedAt: str(source.capturedAt),
      ...(source.kind==='resume'?{fileName:str(source.fileName),quote:str(source.quote),verified:source.verified===true,
        ...(['degree-to-education','equal-language-dimensions'].includes(source.inference?.rule)?{inference:{rule:source.inference.rule,
          inputLabel:str(source.inference.inputLabel),inputValue:str(source.inference.inputValue),targetValue:str(source.inference.targetValue)}}:{})}:{}) };
  }
  function findRecord(template, id) {
    for (const group of template.groups) {
      const record = group.records.find(r => r.id === id);
      if (record) return {group, record, fields: group.fields.filter(f => f.recordId === id)};
    }
    return null;
  }
  function uniqueKey(group, label, record, ignoreId = '') {
    const base = record.name === '基本资料' ? label : `${record.name}-${label}`;
    const used = new Set(group.fields.filter(f => f.id !== ignoreId).map(f => f.key));
    let key = base, n = 2;
    while (used.has(key)) key = `${base} (${n++})`;
    return key;
  }
  function addGroup(template, name) {
    const group = {id: uid(), name: str(name) || '补充信息', records: [], fields: []};
    template.groups.push(group); return group;
  }
  function addRecord(template, groupId, name) {
    const group = template.groups.find(g => g.id === groupId);
    if (!group) throw new Error('分类已不存在，请重新选择。');
    const record = {id: uid(), name: str(name) || '新建经历'};
    group.records.push(record); return record;
  }
  function addField(template, recordId, label, value = '', source = {kind:'manual'}) {
    const found = findRecord(template, recordId);
    if (!found || !str(label)) throw new Error('请选择所属经历并填写字段名。');
    if (found.fields.some(f => f.label === str(label))) throw new Error('这条经历已有同名字段，请修改已有字段。');
    const field = {id: uid(), recordId, label: str(label), key: uniqueKey(found.group, str(label), found.record), value: String(value), source: normalizeSource(source)};
    found.group.fields.push(field); return field;
  }
  function moveRecord(template, recordId, groupId) {
    const found = findRecord(template, recordId), target = template.groups.find(g => g.id === groupId);
    if (!found || !target) throw new Error('分类或经历已不存在。');
    if (found.group.id === groupId) return;
    found.group.records = found.group.records.filter(r => r.id !== recordId);
    found.group.fields = found.group.fields.filter(f => f.recordId !== recordId);
    target.records.push(found.record);
    for (const field of found.fields) {
      if (target.fields.some(f => f.key === field.key)) field.key = uniqueKey(target, field.label, found.record);
      target.fields.push(field);
    }
  }
  function moveField(template, fieldId, recordId) {
    const source = template.groups.find(g => g.fields.some(f => f.id === fieldId));
    const field = source?.fields.find(f => f.id === fieldId), target = findRecord(template, recordId);
    if (!field || !target) throw new Error('请选择有效的目标记录。');
    if (field.recordId === recordId) return;
    const same=target.fields.filter(f=>f.label===field.label);
    if(same.length) {
      if(same.length!==1||str(same[0].value))throw new Error('目标记录已有同名字段，请先区分字段名称。');
      // An empty preparation slot is replaceable. Preserve the actual candidate's
      // identity, value, quote and review status when the user chooses its record.
      target.group.fields=target.group.fields.filter(f=>f.id!==same[0].id);
    }
    source.fields = source.fields.filter(f => f.id !== fieldId);
    field.recordId = recordId;
    field.key = uniqueKey(target.group, field.label, target.record);
    target.group.fields.push(field);
  }
  function collectCandidates(template, pageFields, source) {
    const existing = template.groups.flatMap(g => g.fields.map(f => ({...f, group:g.name})));
    const held = new Set(template.pending.map(p => JSON.stringify([p.group, p.recordIndex, p.key, p.value, p.source.host])));
    const candidates = [];
    for (const f of pageFields || []) {
      const key = str(f.label || f.key), value = str(f.value), group = str(f.group);
      if (!key || !value || key.length > 80 || value.length > 20000 || ['password','file','hidden','checkbox','submit','button'].includes(f.inputType)) continue;
      if (root.ResumeProSecretFields?.isSecretFieldName(key) || root.ResumeProSecretFields?.isSecretFieldValue(value)) continue;
      // Suppress only an unambiguous same-name, same-value fact. Repeated rows still need a destination.
      const exact = existing.filter(e => (e.label === key || e.key === key) && e.value === value && (!group || e.group === group));
      if (exact.length === 1 && !f.recordIndex) continue;
      const proposal = {id:uid(), key, value, group, recordIndex:Number(f.recordIndex)||0, source:normalizeSource(source)};
      const signature = JSON.stringify([group, proposal.recordIndex, key, value, proposal.source.host]);
      if (held.has(signature)) continue;
      held.add(signature); candidates.push(proposal);
    }
    return candidates;
  }
  function acceptProposal(template, proposalId, {recordId, fieldId = '', label}) {
    const proposal = template.pending.find(p => p.id === proposalId), target = findRecord(template, recordId);
    if (!proposal || !target) throw new Error('请选择补充内容的所属经历。');
    let field;
    if (fieldId) {
      field = target.fields.find(f => f.id === fieldId);
      if (!field) throw new Error('目标字段已不存在。');
      field.value = proposal.value; field.source = {...proposal.source};
    } else field = addField(template, recordId, label || proposal.key, proposal.value, proposal.source);
    template.pending = template.pending.filter(p => p.id !== proposalId);
    return field;
  }
  const api = {VERSION, normalizeTemplate, inferRecord, findRecord, uniqueKey, addGroup, addRecord, addField, moveRecord, moveField, collectCandidates, acceptProposal};
  root.ResumeProTree = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
