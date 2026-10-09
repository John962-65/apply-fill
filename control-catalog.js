/* Public DOM contracts. A component family does not prove which ATS hosts a page. */
(function (root) {
  'use strict';
  const npm = (name, version) => `https://www.npmjs.com/package/${name}/v/${version}`;
  const contracts = [
    {
      id: 'phoenix', name: '北森 Phoenix', evidence: 'published-source', version: '3.3.55',
      sources: ['select', 'single-select-list', 'select-list', 'unmodeled-layer', 'date-picker', 'rc-calendar', 'form'].map(n => npm('@beisen-phoenix/' + n, '3.3.55')).concat('https://acdn.bstatics.com/ux/ux-recruitment-portal-2022-form-pc/release/dist/beisen-phoenix-part2-502f98f31630e64ee05b.chk.js'),
      selectRoot: '.phoenix-select,.phoenix-select__cont', trigger: '.phoenix-select,.phoenix-select__cont,.phoenix-select__inputWrapper',
      // select-list is a separate published component. Its click handler is on singleLabel,
      // while the parent listItem carries the disabled flag. Multi-select checkboxes are separate.
      display: '.phoenix-select__tipEle', option: '.phoenix-single-select-list__item,.phoenix-selectList__singleLabel',
      // UnmodeledLayer also wraps ordinary triggers/forms. Its class alone is not a popup.
      selectPanel: '.phoenix-single-select-list,.phoenix-selectList,.phoenix-calendar',
      layerRoot: '.phoenix-unmodeled-layer__content,.common-unmodeled-layer__layerContent',
      captureRoot: '.phoenix-select,.phoenix-select__cont',
      label: '.phoenix-form-item-label-content', formItem: '.phoenix-form-item', driver: 'phoenix'
    },
    {
      id: 'feishu-ud', name: '飞书 UD', evidence: 'site-observation', version: '2026-10-09 captured selectors and popups',
      sources: ['https://nio.jobs.feishu.cn/campus/resume/edit'],
      // The captured search input and its parent have pointer-events:none.
      // Activate the selector surface and verify the committed caption instead.
      selectRoot: '.ud__select', trigger: '.ud__select__selector',
      selectPanel: '.ud__select__dropdown', option: '.ud__select__list__item,.ud__tree__node__label',
      display: '.ud__select__selector__selectItem:not(.ud__select__selector__selectItem-inputting)',
      dateRoot: '.ud__picker,.throne-biz-date-range-picker,.throne-biz-date-range-picker-input',
      datePanel: '.ud__picker-dropdown',
      captureRoot: '.ud__select,.ud__picker,.throne-biz-date-range-picker,.throne-biz-date-range-picker-input',
      formItem: '.ud-formily-item', label: '[class*="ud-formily-item-label"]', driver: 'observe-select'
    },
    {
      id: 'ant-select', name: 'Ant Design 下拉', evidence: 'existing-adapter', version: '3/4/5 DOM',
      sources: ['https://github.com/John962-65/apply-fill'],
      selectRoot: '.ant-select', trigger: '.ant-select-selector,.ant-select-selection',
      display: '.ant-select-selection-item,.ant-select-selection-selected-value,.ant-select-selection__choice__content',
      option: '.ant-select-item-option,.ant-select-dropdown-menu-item,.ant-select-tree-node-content-wrapper',
      selectPanel: '.ant-select-dropdown', driver: 'observe-select'
    },
    {
      id: 'atsx', name: '飞书 ATSX', evidence: 'site-observation', version: 'existing-adapter',
      sources: ['https://github.com/John962-65/apply-fill'],
      selectRoot: '.atsx-select', trigger: '.atsx-select-selector,.atsx-select-selection',
      display: '.atsx-select-selection-item,.atsx-select-selection-selected-value,.atsx-select-selection__choice__content',
      option: '.atsx-select-item-option,.atsx-select-dropdown-menu-item,.atsx-select-tree-node-content-wrapper',
      selectPanel: '.atsx-select-dropdown', dateRoot: '.atsx-calendar-picker,.atsx-date-picker',
      datePanel: '.atsx-calendar-picker-container,.atsx-calendar,.atsx-date-picker-dropdown', driver: 'atsx'
    },
    {
      id: 'ant-picker', name: 'Ant Design 现代日历', evidence: 'published-source', version: 'rc-picker 4.11.3',
      sources: [npm('rc-picker', '4.11.3')],
      dateRoot: '.ant-picker', datePanel: '.ant-picker-dropdown', driver: 'calendar-panel',
      calendar: { panel: '.ant-picker-panel', yearGrid: '.ant-picker-year-panel', monthGrid: '.ant-picker-month-panel', dayGrid: '.ant-picker-date-panel',
        confirmButton: '.ant-picker-ok button', unsupported: '.ant-picker-time-panel',
        yearCells: '.ant-picker-cell-in-view', monthCells: '.ant-picker-cell-in-view', dayCells: '.ant-picker-cell-in-view:not(.ant-picker-cell-week)',
        yearButton: '.ant-picker-year-btn', monthButton: '.ant-picker-month-btn', header: '.ant-picker-header-view',
        prevYear: '.ant-picker-header-super-prev-btn', nextYear: '.ant-picker-header-super-next-btn',
        prevMonth: '.ant-picker-header-prev-btn', nextMonth: '.ant-picker-header-next-btn',
        prevDecade: '.ant-picker-header-super-prev-btn', nextDecade: '.ant-picker-header-super-next-btn' }
    },
    {
      id: 'ant-calendar', name: 'Ant Design 旧版日历', evidence: 'existing-adapter', version: '3.x DOM',
      sources: ['https://github.com/John962-65/apply-fill'],
      dateRoot: '.ant-calendar-picker,.ant-date-picker', datePanel: '.ant-calendar-picker-container,.ant-calendar', driver: 'legacy-calendar'
    },
    {
      id: 'element', name: 'Element UI', evidence: 'published-source', version: '2.15.14',
      sources: [npm('element-ui', '2.15.14')],
      selectRoot: '.el-select', trigger: '.el-select__wrapper,.el-select__input,.el-select .el-input__inner',
      display: '.el-select__selected-item,.el-select__placeholder', option: '.el-select-dropdown__item',
      selectPanel: '.el-select-dropdown', dateRoot: '.el-date-editor', datePanel: '.el-picker-panel', driver: 'calendar-panel',
      label: '.el-form-item__label', formItem: '.el-form-item',
      calendar: { panel: '.el-picker-panel', yearGrid: '.el-year-table', monthGrid: '.el-month-table', dayGrid: '.el-date-table',
        confirmButton: '.el-picker-panel__footer button.is-plain', unsupported: '.el-date-picker__time-header',
        yearCells: 'td.available', monthCells: 'td', dayCells: 'td.available:not(.prev-month):not(.next-month)',
        inner: 'a.cell', yearButton: '.el-date-picker__header-label', monthButton: '.el-date-picker__header-label', header: '.el-date-picker__header',
        prevYear: '.el-icon-d-arrow-left', nextYear: '.el-icon-d-arrow-right',
        prevMonth: '.el-icon-arrow-left', nextMonth: '.el-icon-arrow-right',
        prevDecade: '.el-icon-d-arrow-left', nextDecade: '.el-icon-d-arrow-right' }
    },
    {
      id: 'iview', name: 'iView / View UI', evidence: 'published-source', version: '4.7.0',
      sources: [npm('view-design', '4.7.0')],
      selectRoot: '.ivu-select', trigger: '.ivu-select-selection', display: '.ivu-select-selected-value,.ivu-tag-text',
      option: '.ivu-select-item', selectPanel: '.ivu-select-dropdown',
      dateRoot: '.ivu-date-picker', datePanel: '.ivu-date-picker-transfer,.ivu-picker-panel-body-wrapper', driver: 'calendar-panel',
      label: '.ivu-form-item-label', formItem: '.ivu-form-item',
      calendar: { panel: '.ivu-picker-panel-body-wrapper', yearGrid: '.ivu-date-picker-cells-year', monthGrid: '.ivu-date-picker-cells-month',
        confirmButton: '.ivu-picker-confirm button.ivu-btn-primary', unsupported: '.ivu-time-picker,.ivu-picker-confirm-time',
        dayGrid: '.ivu-date-picker-cells:not(.ivu-date-picker-cells-year):not(.ivu-date-picker-cells-month)',
        yearCells: '.ivu-date-picker-cells-cell', monthCells: '.ivu-date-picker-cells-cell',
        dayCells: '.ivu-date-picker-cells-cell:not(.ivu-date-picker-cells-cell-prev-month):not(.ivu-date-picker-cells-cell-next-month):not(.ivu-date-picker-cells-cell-week-label)',
        yearButton: '.ivu-date-picker-header-label', monthButton: '.ivu-date-picker-header-label', header: '.ivu-date-picker-header',
        prevYear: '.ivu-date-picker-prev-btn-arrow-double', nextYear: '.ivu-date-picker-next-btn-arrow-double',
        prevMonth: '.ivu-date-picker-prev-btn-arrow', nextMonth: '.ivu-date-picker-next-btn-arrow',
        prevDecade: '.ivu-date-picker-prev-btn-arrow-double', nextDecade: '.ivu-date-picker-next-btn-arrow-double' }
    },
    {
      id: 'react-select', name: 'React Select', evidence: 'published-source', version: '5.10.2',
      sources: [npm('react-select', '5.10.2')],
      // Require the documented input semantics; arbitrary '*-control' layout is not a select.
      selectRoot: '[class$="-control"]:has(input[role="combobox"][aria-autocomplete="list"]),[class*="__control"]:has(input[role="combobox"][aria-autocomplete="list"])',
      trigger: 'input[role="combobox"][aria-autocomplete="list"]',
      display: '[class*="singleValue"],[class*="single-value"]', option: '[role="option"]',
      selectPanel: '[role="listbox"]', driver: 'observe-select'
    },
    {
      id: 'beisen-form', name: '北森表单布局线索', evidence: 'open-source-observation', version: '20e5e335',
      sources: ['https://github.com/JuanHoi1996/ResumeFiller/blob/20e5e335bdd33bd2577aea87a603ce87af870d17/content.js'],
      captureRoot: '.form-item--phoenix', formItem: '.form-item--phoenix', label: '.form-item__title,label.form-item__text', driver: 'label-only'
    },
    {
      id: 'sd-select', name: 'sd-Select 结构线索', evidence: 'open-source-observation', version: '20e5e335',
      sources: ['https://github.com/JuanHoi1996/ResumeFiller/blob/20e5e335bdd33bd2577aea87a603ce87af870d17/content.js'],
      // CSS-module suffixes appeared in the user's v0.8.16 structure trace.
      // This remains an observation hint; the bounded generic controller owns clicks.
      captureRoot: '[class*="sd-Select-container"]', driver: 'capture-only'
    },
    {
      id: 'moka-observed', name: 'Moka 结构线索', evidence: 'open-source-observation', version: 'a904fa9b',
      sources: ['https://github.com/cloud-oc/resume-bridge/blob/a904fa9b070de7c07ec7f5026cab0e6d8dfbb3b0/src/core/engine/atsProfiles.ts'],
      captureRoot: '.moka-select,.moka-input', driver: 'capture-only'
    }
  ];
  const selector = key => [...new Set(contracts.map(c => c[key]).filter(Boolean))].join(',');
  function fieldRoot(node) {
    const wrappers='.ud-formily-item-control,.ud-formily-item-control-content,.ud-formily-item-control-content-component';
    let control = node?.closest?.(wrappers);
    if (!control) return null;
    // Stop at the first boundary outside the control wrappers, never the section.
    // The real item also has ud-formily-item-control-align-left. A substring
    // selector climbs past that item and loses its label (or borrows 姓名).
    for (let i=0;i<6 && control.parentElement?.matches(wrappers);i++) control=control.parentElement;
    const item=control.parentElement;
    if (!item || item.matches('body,html,form,main,section')) return null;
    const controls=Array.from(item.querySelectorAll(wrappers));
    return controls.every(n=>n===control||control.contains(n))?item:null;
  }
  function isPopup(node) {
    // This class is the school input's open-state wrapper, not a dropdown.
    // It exists even when there are no suggestions, and contains the trigger.
    return Boolean(node&&!node.matches('.ud__select__dropdown-open')
      &&!node.matches(selector('selectRoot')));
  }
  function dismissSurface(node) {
    const item=fieldRoot(node);
    if(!item)return null;
    const labels=Array.from(item.querySelectorAll('[class*="ud-formily-item-label"]'))
      .filter(n=>!n.contains(node)&&!n.querySelector('input,textarea,select,button,a,[role="button"],[role="combobox"],label[for]'));
    const outer=labels.filter(n=>!labels.some(other=>other!==n&&other.contains(n)));
    return outer.length===1?outer[0]:null;
  }
  function sampleTargets(targets,limit) {
    const groups=new Map();
    const variants=new Map();
    for(const item of targets){
      const node=item.node;
      const family=identify(node)?.id||'';
      const key=[family,item.control||'',item.labelSafe?item.label||'':'',
        node?.closest?.('.throne-biz-date-range-picker-input')?'range':node?.closest?.('.ud__picker')?'picker':''].join('|');
      if(!groups.has(key))groups.set(key,[]);groups.get(key).push(item);
      let shape='';
      const ud=node?.closest?.('.ud__select');
      if(ud)shape=ud.querySelector('.ud__select__dropdown-open input')?'editable':ud.closest('.ud__input-group')?'calling-code'
        :ud.querySelector('input[readonly]')?'finite':'search';
      if(node?.closest?.('.ud__picker,.throne-biz-date-range-picker-input')){
        const format=(node.matches('input')?node:node.querySelector('input'))?.getAttribute('placeholder')||'';
        shape=(node.closest('.throne-biz-date-range-picker-input')?'range':'picker')+'|'+(/dd|日/i.test(format)?'day':/mm|月/i.test(format)?'month':/^yyyy$/i.test(format)?'year':'unknown');
      }
      const variant=[family,item.control||'',shape].join('|');
      if(!variants.has(variant))variants.set(variant,item);
    }
    // Reserve the first pass for distinct widget shapes. Gender/country/two
    // address lists must not consume all seven slots before a range calendar.
    const out=Array.from(variants.values()).slice(0,limit),seen=new Set(out);
    while(out.length<limit&&groups.size){
      for(const [key,items] of groups){
        if(out.length>=limit)break;
        while(items.length&&seen.has(items[0]))items.shift();
        if(items.length){const item=items.shift();seen.add(item);out.push(item);}
        if(!items.length)groups.delete(key);
      }
    }
    return out;
  }
  function popupRoot(panel) {
    if (!panel?.closest) return panel;
    const layer = panel.closest(selector('layerRoot'));
    if (!layer) return panel;
    // Include popup search/header siblings, but never promote to a containing resume form.
    const controls = `form,textarea,select,label:has(input),input[data-label],input[aria-labelledby],${selector('formItem')},${selector('selectRoot')},${selector('dateRoot')}`;
    const outside = Array.from(layer.querySelectorAll(controls)).some(n => !panel.contains(n));
    return outside ? panel : layer;
  }
  function identify(node) {
    if (!node?.closest) return null;
    const matches = contracts.map(c => ({c, n:node.closest([c.selectRoot,c.dateRoot,c.captureRoot].filter(Boolean).join(',') || ':not(*)')})).filter(m => m.n);
    // A containing layout hint must not hide a nested, known control.
    const match = matches.find(m => !matches.some(other => other.n !== m.n && m.n.contains(other.n)));
    return match ? {id:match.c.id,name:match.c.name,evidence:match.c.evidence,version:match.c.version,driver:match.c.driver} : null;
  }
  const api = {version:2,contracts,selector,popupRoot,isPopup,dismissSurface,identify,fieldRoot,sampleTargets};
  root.ResumeProControlCatalog = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
