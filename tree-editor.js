(function(root) {
  const T = root.ResumeProTree;
  const S = root.ResumeProSchema;
  const I = root.ResumeProImport;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const button = (action, text, cls='secondary-button', extra='') => `<button type="button" class="${cls}" data-tree-action="${action}" ${extra}>${text}</button>`;
  class ResumeTreeEditor {
    constructor(host, actions) {
      this.host=host; this.actions=actions; this.collapsed=new Set(); this.query=''; this.selected=''; this.dirty=false; this.organizing=false;
      this.importing=false;this.importSaveChain=Promise.resolve();
      host.addEventListener('click', e => {
        const el=e.target.closest('[data-tree-action]');
        if(el) this.action(el.dataset.treeAction, el).catch(error => this.status(error.message, true));
      });
      host.addEventListener('input', e => this.input(e.target));
      host.addEventListener('change', e => this.change(e.target).catch(error => this.status(error.message,true)));
      root.addEventListener('beforeunload', e => { if(this.dirty) {e.preventDefault();e.returnValue='';} });
    }
    sync(state) {
      this.state=state;
      if(this.importing&&this.dirty)return;
      const active=state.templates.find(t=>t.id===state.activeTemplateId)||state.templates[0];
      if(this.dirty) {
        const current=state.templates.find(t=>t.id===this.draft.id);
        if(current && JSON.stringify({...current,pending:[]})===JSON.stringify({...this.base,pending:[]})) {
          // Collection can arrive while typing. Merge the independent inbox without overwriting the draft.
          const baseIds=new Set(this.base.pending.map(p=>p.id));
          const local=new Map(this.draft.pending.map(p=>[p.id,p]));
          this.draft.pending=current.pending.filter(p=>!baseIds.has(p.id)||local.has(p.id)).map(p=>structuredClone(local.get(p.id)||p));
          this.base=structuredClone(current);
          const nav=this.host.querySelector('[data-tree-nav]'); if(nav) nav.innerHTML=this.navHtml();
        } else if(JSON.stringify(current)!==JSON.stringify(this.base)) this.status('资料已在其他页面更新。编辑内容仍保留；请复制需要保留的改动后重新加载。',true);
        return;
      }
      this.base=active?structuredClone(active):null; this.draft=active?structuredClone(active):null;
      if(this.draft && !T.findRecord(this.draft,this.selected) && !['inbox','catalog'].includes(this.selected) && !this.selected.startsWith('section:')) this.selected=this.draft.groups.flatMap(g=>g.records)[0]?.id||'';
      if(location.hash==='#templates:inbox') {this.selected='inbox'; history.replaceState(null,'','#templates');}
      this.paint();
    }
    beginImport(template,state) {
      clearTimeout(this.importTimer);
      this.state=state;this.draft=structuredClone(template);this.importSaved=structuredClone(template);this.base=null;
      this.importing=true;this.dirty=true;this.query='';
      this.collapsed=new Set(this.draft.groups.filter(g=>!g.fields.some(f=>f.value.trim())).map(g=>g.id));
      this.selected=I.pendingFields(this.draft)[0]?.recordId||this.draft.groups.flatMap(g=>g.records)[0]?.id||'';
      this.paint();
    }
    async flushImportDraft() {
      clearTimeout(this.importTimer);
      if(!this.importing)return;
      const run=async()=>{
        if(!this.importing)return;
        const draft=structuredClone(this.draft),base=structuredClone(this.importSaved);
        if(JSON.stringify(draft)===JSON.stringify(base))return;
        await this.actions.persistDraft(draft,base);this.importSaved=draft;
      };
      this.importSaveChain=this.importSaveChain.then(run,run);
      return this.importSaveChain;
    }
    async discardImport() {
      if(!this.importing)return;
      await this.flushImportDraft();await this.actions.discardDraft(this.importSaved);
      this.importing=false;clearTimeout(this.importTimer);
    }
    status(text,error=false) {
      const el=this.host.querySelector('[data-tree-status]');
      if(el) {el.textContent=text;el.classList.toggle('is-error',error);}
    }
    changed() {
      this.dirty=true;
      const save=this.host.querySelector('[data-tree-action="save"]'); if(save) save.disabled=false;
      const badge=this.host.querySelector('[data-dirty]'); if(badge) badge.textContent='有未保存更改';
      if(this.importing) {
        clearTimeout(this.importTimer);this.importTimer=setTimeout(()=>this.flushImportDraft().catch(e=>this.status(e.message,true)),300);
        const nav=this.host.querySelector('[data-tree-nav]');if(nav)nav.innerHTML=this.navHtml();
        const count=this.host.querySelector('[data-review-count]');if(count)count.textContent=I.pendingFields(this.draft).length;
        if(badge)badge.textContent=`还有 ${I.pendingFields(this.draft).length} 项待核对；确认保存后用于填写`;
      }
    }
    paint() {
      const t=this.draft;
      this.host.innerHTML=`
        <div class="tree-template-bar">
          <label class="tree-template-picker">${this.importing?'正在核对的资料':'当前填写资料'}<select data-template-picker aria-label="切换简历资料">${this.importing?`<option value="${esc(t.id)}" selected>${esc(t.name)} · 核对草稿</option>`:''}${(this.state?.templates||[]).map(x=>`<option value="${esc(x.id)}" ${x.id===t?.id?'selected':''}>${esc(x.name)}</option>`).join('')||'<option>暂无资料</option>'}</select></label>
          <div class="tree-tools">${button('create','＋ 新建资料')}${t?button('catalog','标准资料结构')+button('rename-template','重命名')+(this.importing?'':button('export','导出 Excel')+button('delete-template','删除资料','text-button')):''}</div>
        </div>
        ${t?`${this.importing?this.reviewBannerHtml():''}<div class="tree-workspace">
          <aside class="tree-navigation" aria-label="资料目录">
            <label class="tree-search">搜索资料<input type="search" data-search placeholder="学校、项目、字段或内容…" value="${esc(this.query)}"></label>
            <nav data-tree-nav aria-label="分类与经历">${this.navHtml()}</nav>
            ${button('add-group','＋ 添加分类','text-button tree-add-category')}
          </aside>
          <section class="tree-detail" aria-label="资料编辑区" data-tree-detail>${this.detailHtml()}</section>
        </div>
        <div class="tree-savebar"><span data-dirty>${this.importing?`还有 ${I.pendingFields(t).length} 项待核对；确认保存后用于填写`:this.dirty?'有未保存更改':'更改后点击保存；网页补充需确认后才用于填写'}</span><div>${button('reload',this.importing?'放弃草稿':'重新加载','text-button')}${button('save',this.importing?'确认核对并保存':'保存更改','primary-button',this.dirty?'':'disabled')}</div></div>`:
        `<div class="tree-empty"><span class="tree-empty-icon">＋</span><h3>按标准结构准备简历资料</h3><p>上传简历，由 AI 填入固定字段，再核对修改。也可新建资料逐项补充。</p>${button('create','新建第一份资料','primary-button')}</div>`}
        <p class="tree-status" data-tree-status role="status" aria-live="polite"></p>`;
      if(this.selected==='inbox') this.host.querySelectorAll('[data-proposal]').forEach(card=>this.renderProposalTarget(card));
    }
    reviewBannerHtml() {
      const pending=I.pendingFields(this.draft),unverified=pending.filter(f=>!f.source?.verified);
      return `<div class="tree-review-banner" role="status"><div><strong>AI 提取 → 人工核对 → 确认保存</strong><p>还需核对 <b data-review-count>${pending.length}</b> 项${unverified.length?`，其中 ${unverified.length} 项原文依据未匹配`:''}。草稿会自动暂存，重新打开可继续；当前网页填写资料保持原选择。</p></div>${button('review-next','查看下一条待核对','secondary-button')}${(this.draft.importReview.warnings||[]).map(w=>`<p class="tree-data-issue">${esc(w)}</p>`).join('')}</div>`;
    }
    navHtml() {
      const q=this.query.trim().toLowerCase();
      let html=button('inbox',`待确认补充 <span class="tree-count">${this.draft.pending.length}</span>`,`tree-node tree-inbox ${this.selected==='inbox'?'is-selected':''}`);
      for(const g of this.draft.groups) {
        const rows=g.records.filter(r=>!q || [g.name,r.name,...g.fields.filter(f=>f.recordId===r.id).flatMap(f=>[f.label,f.value])].join(' ').toLowerCase().includes(q));
        if(q && !rows.length) continue;
        const open=q || !this.collapsed.has(g.id);
        html+=`<div class="tree-category"><div class="tree-category-heading">${button('toggle',`${open?'▾':'▸'} ${esc(g.name)} <span class="tree-count">${g.records.length}</span>`,'tree-node',`data-id="${esc(g.id)}" aria-expanded="${Boolean(open)}"`)}${button('add-record','＋','tree-small',`data-id="${esc(g.id)}" aria-label="在${esc(g.name)}新增记录"`)}</div>`;
        if(open) html+=`<div class="tree-branches">${rows.map(r=>{
          const fields=g.fields.filter(f=>f.recordId===r.id),pending=fields.filter(f=>f.value.trim()&&f.review?.status==='pending').length;
          return button('select',`<span>${esc(r.name)}</span><small>${pending?`${pending} 待核对`:`${fields.filter(f=>f.value.trim()).length}/${fields.length} 已填`}</small>`,`tree-node tree-record ${this.selected===r.id?'is-selected':''}`,`data-id="${esc(r.id)}" ${this.selected===r.id?'aria-current="true"':''}`);
        }).join('')||'<p class="tree-hint">暂无经历；有相关信息时点击 ＋</p>'}${button('section-guide','查看字段清单','text-button',`data-id="${esc(g.id)}"`)}</div>`;
        html+=`<div class="tree-category-actions">${button('rename-group','改名','text-button',`data-id="${esc(g.id)}"`)}${!g.records.length?button('delete-group','移除空分类','text-button',`data-id="${esc(g.id)}"`):''}</div></div>`;
      }
      return html;
    }
    detailHtml() {
      if(this.selected==='catalog') return this.catalogHtml();
      if(this.selected==='inbox') return this.inboxHtml();
      if(this.selected.startsWith('section:'))return this.sectionHtml(this.selected.slice(8));
      const found=T.findRecord(this.draft,this.selected);
      if(!found) return '<div class="tree-empty"><h3>选择一条经历开始编辑</h3><p>也可以点击分类旁的 ＋ 创建记录。</p></div>';
      const {group,record,fields}=found;
      const schema=S.getSection(group.name);
      return `<div class="tree-detail-heading"><div><p class="tree-breadcrumb">${esc(this.draft.name)} / ${esc(group.name)}</p><h2>${esc(record.name)}</h2></div><div class="tree-tools">${button('record-up','上移','text-button')}${button('record-down','下移','text-button')}${button('delete-record','删除记录','text-button')}</div></div>
        <div class="tree-record-settings"><label>记录名称<input data-record-name value="${esc(record.name)}" maxlength="150"></label><label>所属分类<select data-record-group>${this.draft.groups.map(g=>`<option value="${esc(g.id)}" ${g.id===group.id?'selected':''}>${esc(g.name)}</option>`).join('')}</select></label></div>
        ${this.recordSchemaHtml(schema,fields)}
        ${fields.some(f=>f.review?.status==='pending'&&f.value.trim())?`<div class="tree-record-review"><p>先核对所属经历、字段内容和原文依据，再确认本条信息。</p>${button('review-record','确认本条已核对','primary-button')}</div>`:''}
        <div class="tree-field-grid">${fields.map(f=>this.fieldHtml(schema,f)).join('')||'<p class="tree-hint">这条记录还没有字段。可以添加学校、时间、职责等内容。</p>'}</div>
        ${button('add-field','＋ 添加字段','secondary-button tree-add-field')}`;
    }
    fieldHtml(schema,f) {
      const definition=S.definition(schema,f.label),pending=f.review?.status==='pending'&&f.value.trim();
      const status=!f.value.trim()?'待补充':pending?'AI 提取 · 待核对':f.review?.edited?'已人工修改':f.review?'已核对':'';
      return `<article class="tree-field-card ${f.value.length>150?'is-wide':''} ${pending?'is-pending':''}" data-field="${esc(f.id)}"><div class="tree-field-header"><input aria-label="字段名称" data-field-label value="${esc(f.label)}" maxlength="100">${button('move-field','归类','text-button',`data-id="${esc(f.id)}"`)}${button('delete-field','移除','text-button',`data-id="${esc(f.id)}"`)}</div><div class="tree-field-state"><span>${status}</span>${definition?`<span>${definition.core?'常用字段':'按需补充'}</span>`:''}${pending?button('review-field','标记已核对','text-button',`data-id="${esc(f.id)}"`):''}</div><textarea aria-label="${esc(f.label)}的内容" data-field-value rows="${f.value.length>100?'5':'2'}" placeholder="${esc(definition?.hint||'未提供可留空')}">${esc(f.value)}</textarea>
        ${f.review?.reason?`<p class="tree-hint" data-review-reason>${esc(f.review.reason)}</p>`:''}
        ${f.source?.inference?`<p class="tree-hint" data-source-inference>有依据的推导：${esc(f.source.inference.inputLabel)}“${esc(f.source.inference.inputValue)}” → “${esc(f.source.inference.targetValue)}”。原文已保留。</p>`:''}
        ${f.source?.kind==='resume'?`<details class="tree-source-quote" ${pending&&!f.source.verified?'open':''}><summary>简历原文依据${f.source.verified?'':' · 请核对'}</summary><pre>${esc(f.source.quote||'未找到包含该值的原句，请对照上传简历核对或修改。')}</pre><small>${esc(f.source.fileName)}</small></details>`:`<small>${f.source?.kind==='web'?`来自 ${esc(f.source.host)} · 已确认`:'保存在本机资料中'}</small>`}</article>`;
    }
    sectionHtml(groupId) {
      const group=this.draft.groups.find(g=>g.id===groupId),schema=S.getSection(group?.name);
      if(!schema)return '<p class="tree-hint">自定义分类可自行添加字段。</p>';
      return `<div class="tree-detail-heading"><div><p class="tree-breadcrumb">标准资料树 · 字段清单</p><h2>${esc(schema.name)}</h2></div>${button('add-record',schema.repeat?'＋ 添加一条记录':'＋ 添加资料','secondary-button',`data-id="${esc(group.id)}"`)}</div><p class="tree-hint">${esc(schema.note||'按简历原文或本人核对的信息填写。')} ${schema.repeat?'每条经历单独保存；没有相关经历可不添加记录。':'本人信息单独保存。'} 以下是准备清单，各招聘网站必填项会有差别。</p><div class="tree-field-checklist">${schema.fields.map(f=>`<article><strong>${esc(f.label)}</strong><span>${f.core?'常用字段':'按需补充'}</span><p>${esc(f.hint||'简历中有则提取，没有则留空待补充')}</p></article>`).join('')}</div>`;
    }
    catalogHtml() {
      return `<div class="tree-detail-heading"><div><p class="tree-breadcrumb">秋招网申资料准备</p><h2>选择需要的资料分类</h2></div></div>
        <p class="tree-hint">参考 Moka、飞书招聘、北森的公开字段整理。各公司可自定义表单，以下项目不代表全部必填。添加后是空白字段，不会生成个人信息。</p>
        <div class="tree-catalog">${S.sections.map(s=>{
          const existing=this.draft.groups.filter(g=>S.getSection(g.name)?.id===s.id);
          return `<label class="tree-catalog-card"><input type="checkbox" data-section-choice value="${esc(s.id)}" ${s.common&&!existing.length?'checked':''} ${existing.length?'disabled':''}><span><strong>${esc(s.name)}${existing.length?' · 已有':''}</strong><small>${s.repeat?'每条经历单独建记录':'单条基本资料'} · ${s.fields.filter(f=>f.core).map(f=>esc(f.label)).join('、')}</small></span></label>`;
        }).join('')}</div>
        ${button('apply-catalog','添加所选分类','primary-button')}
        <p class="tree-hint">已有经历可进入记录后点击“补齐本条常用字段”。混合分类请用“归类”逐项移动。内推码、调剂意愿和真实性声明按本次申请确认，不放入通用模板。</p>
        <details class="tree-schema-help"><summary>字段来源与适用范围</summary><p>Moka、飞书公开数据结构用于整理共有字段；北森公开教育模块用于补充院系、成绩、学习形式等。论文、专利、考试等为资料管理扩展，不代表每个平台都有独立模块。</p><a href="docs/campus-resume-schema.md" target="_blank" rel="noopener">查看字段调研与版本说明</a></details>`;
    }
    recordSchemaHtml(schema,fields) {
      if(!schema)return '<p class="tree-hint">自定义分类保留原有字段。如需模板，请将记录归入对应分类。</p>';
      const missing=S.missing(schema,fields),core=missing.filter(f=>f.core);
      const issues=S.recordIssues(schema,fields);
      return `<div class="tree-record-guide"><p class="tree-hint">${esc(schema.note||'一条记录对应一段经历；按原始资料填写，未提供的信息留空。')} 已填 ${fields.filter(f=>f.value.trim()).length} / ${fields.length} 项；空白字段可留空，不要求全部填写。</p>
        <div data-record-issues role="status">${issues.map(t=>`<p class="tree-data-issue">${esc(t)}</p>`).join('')}</div>
        ${core.length?button('complete-record',`补齐本条常用字段（${core.length}）`):''}
        ${missing.length?`<details class="tree-schema-help"><summary>可添加字段（${missing.length}）</summary><div class="tree-suggested-fields">${missing.map(f=>button('add-schema-field',`＋ ${esc(f.label)}`,'secondary-button',`data-label="${esc(f.label)}"`)).join('')}</div></details>`:''}</div>`;
    }
    inboxHtml() {
      return `<div class="tree-detail-heading"><div><p class="tree-breadcrumb">网页补充内容</p><h2>先确认归属，再加入资料</h2></div>${button('organize',this.organizing?'AI 正在归纳…':'AI 归纳补充','secondary-button',this.organizing||!this.draft.pending.length?'disabled':'')}${this.organizing?button('cancel-organize','停止等待','text-button'):''}</div><p class="tree-hint">选择所属记录后，可以新增字段或更新已有字段。没有确认的内容不会用于自动填写。仅与本次申请有关的答案可以忽略。AI 归纳会将待确认内容与现有资料发送到你配置的模型接口，每次最多 50 项。</p>
        ${this.draft.pending.map(p=>`<article class="tree-proposal" data-proposal="${esc(p.id)}"><div class="tree-proposal-heading"><h3>${esc(p.key)}</h3>${button('ignore','忽略','text-button',`data-id="${esc(p.id)}"`)}</div><p class="tree-hint">${esc(p.group||'未识别板块')}${p.recordIndex?` · 网页第 ${p.recordIndex} 条`:''} · ${esc(p.source.host)}${p.source.capturedAt?` · ${esc(p.source.capturedAt.slice(0,10))}`:''}</p><p class="tree-hint">网页原文 · 确认入库时保留此内容</p><pre class="tree-proposal-value">${esc(p.value)}</pre>${this.suggestionHtml(p)}
        <label>加入哪条记录？<select data-proposal-record><option value="">请选择所属记录</option>${this.draft.groups.map(g=>`<optgroup label="${esc(g.name)}">${g.records.map(r=>`<option value="${esc(r.id)}" ${p.suggestion?.recordId===r.id?'selected':''}>${esc(r.name)}</option>`).join('')}</optgroup>`).join('')}</select></label>
        <div data-proposal-target></div>${button('accept','确认归属','primary-button',`data-id="${esc(p.id)}" disabled`)}</article>`).join('')||'<div class="tree-empty"><h3>没有待确认的补充</h3><p>在网申页面填写后，点击侧边栏的“采集到资料树”，补充内容会显示在这里。</p></div>'}`;
    }
    suggestionHtml(p) {
      const s=p.suggestion;if(!s)return '';
      const names={add:'建议新增',update:'建议更新',duplicate:'已有相同内容，可忽略',uncertain:'归属待确认'};
      return `<div class="tree-ai-suggestion"><strong>AI 归纳 · ${names[s.action]}</strong>
        <p>${esc(s.groupName||'待定分类')} / ${esc(s.recordName||'待定记录')} · ${esc(s.label||p.key)}</p>
        <p class="tree-hint">${esc(s.reason)}</p>
        ${s.summary?`<details><summary>查看 AI 摘要（仅供参考）</summary><p>${esc(s.summary)}</p><small>原文不会被摘要替换。</small></details>`:''}
        ${!s.recordId&&s.action==='add'&&s.groupName&&s.recordName?button('suggested-record','按建议新建记录','secondary-button',`data-id="${esc(p.id)}"`):''}</div>`;
    }
    input(el) {
      if(el.matches('[data-search]')) {this.query=el.value;this.host.querySelector('[data-tree-nav]').innerHTML=this.navHtml();return;}
      const found=this.draft && T.findRecord(this.draft,this.selected); if(!found)return;
      if(el.matches('[data-record-name]')) {found.record.name=el.value; this.changed();}
      const card=el.closest('[data-field]'); const field=found.fields.find(f=>f.id===card?.dataset.field);
      if(field && el.matches('[data-field-label]')) {field.label=el.value;field.key=T.uniqueKey(found.group,el.value.trim(),found.record,field.id);if(field.review)field.review.status='pending';this.changed();}
      if(field && el.matches('[data-field-value]')) {
        field.value=el.value;if(field.source?.inference){delete field.source.inference;card.querySelector('[data-source-inference]')?.remove();card.querySelector('[data-review-reason]')?.remove();if(field.review)field.review.reason='';}if(field.review)field.review={...field.review,status:'confirmed',edited:true};this.changed();
        const state=card.querySelector('.tree-field-state>span');if(state)state.textContent=field.value.trim()?(field.review?'已人工修改':''):'待补充';
        card.classList.remove('is-pending');card.querySelector('[data-tree-action="review-field"]')?.remove();
        const issues=this.host.querySelector('[data-record-issues]');
        if(issues)issues.innerHTML=S.recordIssues(S.getSection(found.group.name),found.fields).map(t=>`<p class="tree-data-issue">${esc(t)}</p>`).join('');
      }
    }
    async change(el) {
      if(el.matches('[data-template-picker]')) {
        if(this.dirty && !confirm('有未保存更改，放弃后切换资料？')) {el.value=this.draft.id;return;}
        await this.discardImport();
        this.dirty=false;this.selected='';await this.actions.activate(el.value);return;
      }
      if(el.matches('[data-record-group]')) {T.moveRecord(this.draft,this.selected,el.value);this.changed();this.paint();}
      if(el.matches('[data-record-name]')) {
        this.host.querySelector('[data-tree-nav]').innerHTML=this.navHtml();
        this.host.querySelector('.tree-detail-heading h2').textContent=el.value;
      }
      if(el.matches('[data-move-target]') && el.value) {T.moveField(this.draft,el.dataset.moveTarget,el.value);this.changed();this.paint();}
      if(el.matches('[data-proposal-record]')) this.renderProposalTarget(el.closest('[data-proposal]'));
      if(el.matches('[data-proposal-field]')) this.renderConflict(el.closest('[data-proposal]'));
    }
    renderProposalTarget(card) {
      const found=T.findRecord(this.draft,card.querySelector('[data-proposal-record]').value);
      const target=card.querySelector('[data-proposal-target]');
      card.querySelector('[data-tree-action="accept"]').disabled=!found;
      if(!found){target.textContent='';return;}
      const proposal=this.draft.pending.find(p=>p.id===card.dataset.proposal);
      const suggestion=proposal.suggestion;
      const same=found.fields.find(f=>suggestion?.recordId===found.record.id&&f.id===suggestion.fieldId)||found.fields.find(f=>f.label===(suggestion?.label||proposal.key) || f.key===proposal.key);
      target.innerHTML=`<label>保存方式<select data-proposal-field><option value="">新增字段</option>${found.fields.map(f=>`<option value="${esc(f.id)}" ${same?.id===f.id?'selected':''}>更新：${esc(f.label)}</option>`).join('')}</select></label><label data-new-label>新字段名称<input data-proposal-label value="${esc(suggestion?.label||proposal.key)}"></label><div data-conflict></div>`;
      this.renderConflict(card);
    }
    renderConflict(card) {
      const found=T.findRecord(this.draft,card.querySelector('[data-proposal-record]').value);
      const field=found.fields.find(f=>f.id===card.querySelector('[data-proposal-field]').value);
      card.querySelector('[data-new-label]').hidden=Boolean(field);
      card.querySelector('[data-conflict]').innerHTML=field?`<div class="tree-conflict"><strong>将更新已有字段「${esc(field.label)}」</strong><p>原内容</p><pre>${esc(field.value||'（空）')}</pre><p>新内容见上方。确认后仍需点击“保存更改”才生效。</p></div>`:'';
      card.querySelector('[data-tree-action="accept"]').textContent=field?'确认更新此字段':'确认新增字段';
    }
    async action(action,el) {
      const id=el.dataset.id;
      if(action==='section-guide'){this.selected=`section:${id}`;this.paint();return;}
      if(action==='review-next') {
        const records=[...new Set(I.pendingFields(this.draft).map(f=>f.recordId))];
        if(!records.length){this.status('所有 AI 提取内容已核对，可确认保存。');return;}
        this.selected=records[(records.indexOf(this.selected)+1)%records.length];this.paint();return;
      }
      if(action==='review-record'||action==='review-field') {
        if(action==='review-record')I.reviewRecord(this.draft,this.selected);
        else {const f=this.draft.groups.flatMap(g=>g.fields).find(f=>f.id===id);if(f?.review)f.review.status='confirmed';}
        this.changed();this.paint();return;
      }
      if(action==='cancel-organize') {this.organizeController?.abort();return;}
      if(action==='organize') {
        if(this.organizing)return;
        if(this.dirty)throw new Error('请先保存当前更改，再让 AI 归纳。');
        this.organizeController=new AbortController();
        this.organizing=true;this.paint();this.status('AI 正在归纳，原始采集内容已保存。');
        try {const result=await this.actions.organize(this.draft.id,{signal:this.organizeController.signal,onProgress:seconds=>this.status(`AI 正在归纳，已等待 ${seconds} 秒。${seconds>=60?'模型仍未返回，可继续等待或点击“停止等待”。':'原始采集内容已保存。'}`)});this.sync(await this.actions.load());this.status(`AI 已归纳 ${result.organized} 项，请逐项确认。`);}
        finally {this.organizing=false;this.organizeController=null;this.host.querySelector('[data-tree-action="cancel-organize"]')?.remove();const b=this.host.querySelector('[data-tree-action="organize"]');if(b){b.disabled=false;b.textContent='AI 归纳补充';}}return;
      }
      if(action==='suggested-record') {
        const proposal=this.draft.pending.find(p=>p.id===id),s=proposal?.suggestion;
        if(!s||s.action!=='add'||!s.groupName||!s.recordName)throw new Error('没有可用的新记录建议。');
        const groups=this.draft.groups.filter(g=>g.name===s.groupName);
        if(groups.length>1)throw new Error('有多个同名分类，请手动选择所属记录。');
        const g=groups[0]||T.addGroup(this.draft,s.groupName);
        const r=T.addRecord(this.draft,g.id,s.recordName);
        for(const p of this.draft.pending)if(p.source.host===proposal.source.host&&p.source.capturedAt===proposal.source.capturedAt&&p.group===proposal.group&&p.recordIndex===proposal.recordIndex&&p.suggestion?.action==='add'&&!p.suggestion.recordId&&p.suggestion.groupName===s.groupName&&p.suggestion.recordName===s.recordName)p.suggestion.recordId=r.id;
        this.changed();this.paint();return;
      }
      if(action==='save') {
        if(this.importing&&I.pendingFields(this.draft).length) {
          this.selected=I.pendingFields(this.draft)[0].recordId;this.paint();
          this.status(`还有 ${I.pendingFields(this.draft).length} 项待核对，请核对内容后点击“确认本条已核对”。`,true);return;
        }
        if(this.draft.groups.some(g=>g.records.some(r=>!r.name.trim())||g.fields.some(f=>!f.label.trim()))) throw new Error('记录名称和字段名称不能为空。');
        for(const g of this.draft.groups) for(const r of g.records) {
          const labels=g.fields.filter(f=>f.recordId===r.id).map(f=>f.label.trim());
          if(new Set(labels).size!==labels.length) throw new Error(`「${r.name}」中有重复字段名，请先区分。`);
        }
        el.disabled=true;
        try {
          await this.flushImportDraft();if(this.importing)I.completeReview(this.draft);
          await this.actions.save(this.draft,this.base,this.importSaved);this.importing=false;this.dirty=false;
          this.sync(await this.actions.load());this.status('已保存，网申页面会自动使用更新后的资料。');
        }
        catch(error){el.disabled=false;throw error;} return;
      }
      if(action==='reload') {if(this.dirty&&!confirm(this.importing?'放弃此核对草稿？原有填写资料保留。':'放弃未保存更改，重新加载资料？'))return;await this.discardImport();this.dirty=false;this.sync(await this.actions.load());return;}
      if(action==='create') {
        if(this.dirty&&!confirm('放弃未保存更改并新建资料？'))return;
        const name=prompt('新资料的名称，例如“运动规划岗位”');if(!name?.trim())return;
        await this.discardImport();
        this.dirty=false;this.selected='';await this.actions.create(name.trim());return;
      }
      if(action==='export') {if(this.dirty)throw new Error('请先保存更改，再导出 Excel。');await this.actions.export(this.draft.id);return;}
      if(action==='delete-template') {if(!confirm(`删除「${this.draft.name}」及其中所有资料和待确认补充？`))return;this.dirty=false;await this.actions.remove(this.draft.id);return;}
      if(action==='rename-template') {const name=prompt('资料名称',this.draft.name);if(!name?.trim())return;this.draft.name=name.trim();this.changed();this.paint();return;}
      if(action==='catalog'){this.selected='catalog';this.paint();return;}
      if(action==='apply-catalog') {
        const ids=[...this.host.querySelectorAll('[data-section-choice]:checked:not(:disabled)')].map(el=>el.value);
        if(!ids.length){this.status('请选择要添加的分类。');return;}
        const result=S.addSections(this.draft,ids);this.changed();this.paint();
        this.status(`已添加 ${result.groups} 个分类、${result.fields} 个空白字段。请为经历分类添加记录，完成后保存。`);return;
      }
      if(action==='complete-record'||action==='add-schema-field') {
        const added=S.addMissing(this.draft,this.selected,action==='complete-record',el.dataset.label||'');
        if(added){this.changed();this.paint();}this.status(`已添加 ${added} 个空白字段，原有内容保留。`);return;
      }
      if(action==='select'){this.selected=id;this.paint();return;}
      if(action==='inbox'){this.selected='inbox';this.paint();return;}
      if(action==='toggle'){this.collapsed.has(id)?this.collapsed.delete(id):this.collapsed.add(id);this.paint();return;}
      if(action==='add-group'){const name=prompt('分类名称，例如“教育经历”或“语言与证书”');if(!name?.trim())return;const g=T.addGroup(this.draft,name);this.selected=T.addRecord(this.draft,g.id,'基本资料').id;}
      if(action==='rename-group'){const g=this.draft.groups.find(g=>g.id===id);const name=prompt('分类名称',g.name);if(!name?.trim())return;g.name=name.trim();}
      if(action==='delete-group')this.draft.groups=this.draft.groups.filter(g=>g.id!==id || g.records.length);
      if(action==='add-record'){const name=prompt('记录名称，例如“某大学 · 硕士”或项目名称');if(!name?.trim())return;this.selected=T.addRecord(this.draft,id,name).id;S.addMissing(this.draft,this.selected);this.collapsed.delete(id);}
      if(action==='add-field'){const name=prompt('字段名称，例如“专业”“开始时间”“项目成果”');if(!name?.trim())return;T.addField(this.draft,this.selected,name);}
      if(action==='delete-record') {
        const found=T.findRecord(this.draft,this.selected);if(!confirm(`删除「${found.record.name}」及其 ${found.fields.length} 个字段？`))return;
        found.group.records=found.group.records.filter(r=>r.id!==this.selected);found.group.fields=found.group.fields.filter(f=>f.recordId!==this.selected);this.selected=found.group.records[0]?.id||'';
      }
      if(action==='move-field') {
        const card=el.closest('[data-field]');
        let picker=card.querySelector('[data-move-target]');
        if(!picker) {
          const label=document.createElement('label'); label.className='tree-hint'; label.textContent='移动到记录';
          picker=document.createElement('select');picker.dataset.moveTarget=id;
          const blank=document.createElement('option');blank.value='';blank.textContent='请选择目标记录';picker.append(blank);
          for(const g of this.draft.groups) for(const r of g.records) if(r.id!==this.selected) {
            const opt=document.createElement('option');opt.value=r.id;opt.textContent=`${g.name} / ${r.name}`;picker.append(opt);
          }
          label.append(picker);card.append(label);
        }
        picker.focus();return;
      }
      if(action==='delete-field'){const found=T.findRecord(this.draft,this.selected);if(!confirm(this.importing?'移除此字段？核对草稿会自动暂存此修改。':'移除此字段？保存前可以重新加载撤销。'))return;found.group.fields=found.group.fields.filter(f=>f.id!==id);}
      if(action==='record-up'||action==='record-down') {
        const {group,record}=T.findRecord(this.draft,this.selected);const i=group.records.indexOf(record),j=i+(action==='record-up'?-1:1);if(j<0||j>=group.records.length)return;
        [group.records[i],group.records[j]]=[group.records[j],group.records[i]];
        group.fields=group.records.flatMap(r=>group.fields.filter(f=>f.recordId===r.id));
      }
      if(action==='ignore')this.draft.pending=this.draft.pending.filter(p=>p.id!==id);
      if(action==='accept') {
        const card=el.closest('[data-proposal]');
        T.acceptProposal(this.draft,id,{recordId:card.querySelector('[data-proposal-record]').value,fieldId:card.querySelector('[data-proposal-field]').value,label:card.querySelector('[data-proposal-label]').value});
      }
      this.changed();this.paint();
    }
  }
  root.ResumeTreeEditor=ResumeTreeEditor;
})(self);
