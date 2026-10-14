/* Popup ownership and lifecycle. Observations never contain applicant values. */
(function(root){
  'use strict';
  const STATES=Object.freeze({CLOSED:'CLOSED',OPENING:'OPENING',OPEN:'OPEN',SELECTING:'SELECTING',VERIFYING:'VERIFYING',RECOVERING:'RECOVERING',BLOCKED:'BLOCKED'});
  const NEXT={CLOSED:['OPENING','OPEN','RECOVERING','BLOCKED'],OPENING:['OPEN','SELECTING','VERIFYING','RECOVERING','CLOSED','BLOCKED'],
    OPEN:['OPENING','SELECTING','VERIFYING','RECOVERING','CLOSED','BLOCKED'],SELECTING:['OPENING','OPEN','VERIFYING','RECOVERING','CLOSED','BLOCKED'],
    VERIFYING:['OPENING','OPEN','SELECTING','RECOVERING','CLOSED','BLOCKED'],RECOVERING:['OPEN','CLOSED','BLOCKED'],BLOCKED:['OPENING','OPEN','RECOVERING','CLOSED']};
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const outer=nodes=>[...new Set(nodes)].filter(n=>!nodes.some(p=>p!==n&&p.contains(n)));
  // Bounded queries include open shadow roots. Closed roots remain inaccessible.
  function queryAll(scope,selector,limit=2000){
    const result=[],queue=[scope],seen=new Set();
    while(queue.length&&seen.size<24&&result.length<limit){
      const current=queue.shift();if(!current||seen.has(current))continue;seen.add(current);
      for(const n of current.querySelectorAll(selector)){result.push(n);if(result.length>=limit)break;}
      for(const n of Array.from(current.querySelectorAll('*')).slice(0,4000))if(n.shadowRoot&&n.id!=='resume-pro-sidebar')queue.push(n.shadowRoot);
    }
    return [...new Set(result)];
  }
  const forbidden=/^(?:添加|新增|创建|删除|移除|清空|提交|保存|下一步|上一步|登录|注册|同意|没有找到|未找到|加载中|正在加载|loading|save|submit|delete|create|sign in|log in)(?:\b|\s|$|[\u4e00-\u9fff])/i;
  function choiceEnabled(n){
    return !n.closest('[disabled],[aria-disabled="true"],[inert],[hidden],[aria-hidden="true"],[class*="--disabled"],[class*="-disabled"]');
  }
  function structuralOptions(scope,visible){
    if(!scope)return [];
    const groups=new Map(),result=[];
    for(const n of queryAll(scope,'li,div,span,[role="option"],[role="treeitem"]',800)){
      const text=(n.getAttribute('aria-label')||n.textContent||'').trim(),rect=n.getBoundingClientRect();
      if(!visible(n)||!choiceEnabled(n)||!text||text.length>120||rect.height<12||rect.height>100||rect.width<12
        ||n.matches('[role="presentation"],[role="separator"],[role="heading"]')||forbidden.test(text)
        ||n.querySelector('input:not([type="checkbox"]):not([type="radio"]),textarea,select,form,button,a[href]'))continue;
      const parent=n.parentElement;if(!parent)continue;
      const signature=n.tagName+':'+Array.from(n.children).map(c=>c.tagName+':'+Array.from(c.children).map(d=>d.tagName).join('.')).join(',');
      let signatures=groups.get(parent);if(!signatures)groups.set(parent,signatures=new Map());
      let siblings=signatures.get(signature);if(!siblings)signatures.set(signature,siblings=[]);siblings.push(n);
    }
    for(const signatures of groups.values())for(const siblings of signatures.values()){
      const height=siblings[0].getBoundingClientRect().height;
      const same=siblings.filter(n=>Math.abs(n.getBoundingClientRect().height-height)<=Math.max(4,height*.25));
      const vertical=same.every(n=>Math.abs(n.getBoundingClientRect().left-same[0].getBoundingClientRect().left)<=24);
      const single=same.length===1&&(same[0].matches('li,[role="option"],[role="treeitem"],[tabindex]')||getComputedStyle(same[0]).cursor==='pointer');
      if(same.length>=2&&vertical||single)result.push(...same);
    }
    // Prefer the repeated row, not its nested label/icon cluster.
    return [...new Set(result)].filter(n=>!result.some(p=>p!==n&&p.contains(n)));
  }
  function optionColumns(nodes){
    const groups=[];
    for(const n of nodes){
      const r=n.getBoundingClientRect();let group=groups.find(g=>Math.abs(g.left-r.left)<=Math.max(16,Math.min(g.width,r.width)*.2));
      if(!group){group={left:r.left,width:r.width,nodes:[]};groups.push(group);}group.width=Math.max(group.width,r.width);group.nodes.push(n);
    }
    groups.sort((a,b)=>a.left-b.left);
    // Indented tree rows overlap horizontally; they are not cascader columns.
    if(groups.some((g,i)=>i&&g.left<groups[i-1].left+groups[i-1].width-12))return [nodes];
    return groups.map(g=>g.nodes);
  }
  function syntheticClick(node){
    node.scrollIntoView({block:'nearest'});
    const r=node.getBoundingClientRect(),left=Math.max(0,r.left),right=Math.min(innerWidth,r.right),top=Math.max(0,r.top),bottom=Math.min(innerHeight,r.bottom);
    let hit,point;
    for(const [x,y] of [[.5,.5],[.2,.2],[.8,.8]]){
      const p={clientX:left+(right-left)*x,clientY:top+(bottom-top)*y},topmost=document.elementFromPoint(p.clientX,p.clientY);
      // A shadow host may be returned by the document; query its own hit tree.
      let actual=topmost;while(actual?.shadowRoot?.elementFromPoint){const next=actual.shadowRoot.elementFromPoint(p.clientX,p.clientY);if(!next||next===actual)break;actual=next;}
      if(actual&&(actual===node||node.contains(actual))){hit=actual;point=p;break;}
    }
    if(!hit){const e=new Error('操作目标被遮挡，未点击');e.code='input_target_covered';throw e;}
    const init={bubbles:true,composed:true,cancelable:true,button:0,...point};
    for(const type of ['pointerover','mouseover','pointerdown','mousedown'])hit.dispatchEvent(type.startsWith('pointer')?new PointerEvent(type,{...init,pointerId:1,pointerType:'mouse',buttons:type==='pointerdown'?1:0}):new MouseEvent(type,{...init,buttons:type==='mousedown'?1:0}));
    if(hit.matches('input,button,[tabindex]'))hit.focus({preventScroll:true});
    for(const type of ['pointerup','mouseup','click'])hit.dispatchEvent(type==='pointerup'?new PointerEvent(type,{...init,pointerId:1,pointerType:'mouse'}):new MouseEvent(type,init));
    return true;
  }
  const CODES=new Set(['VALUE_VERIFIED','VALUE_UNCONFIRMED','OPTION_COMMIT_UNCONFIRMED','POPUP_OWNERSHIP_UNCONFIRMED','POPUP_CLOSE_UNCONFIRMED','POPUP_RECOVERED',
    'PAGE_MODAL_BLOCKED','OTHER_POPUP_UNCONFIRMED','POPUP_TARGET_RELATED','POPUP_COMPLEX_DEFERRED','TARGET_DISABLED','TARGET_REPLACED','TARGET_MOVING','TARGET_COVERED','PAGE_FOCUS_LOCKED','LOCAL_POPUP_ISOLATED',
    'PRECISION_UNRESOLVED','HANDOFF_UNSAFE','PEER_CHANGED','STALL_DETECTED','BUDGET_EXCEEDED','AI_STOPPED','AGENT_EXECUTION_ERROR','INVALID_ACTION_ID','GENERIC_AGENT_UNAVAILABLE','RUN_CONTEXT_CHANGED']);
  function safeCode(code){return typeof code==='string'&&(CODES.has(code)||/^input_(?:invalid|too_long|target_(?:missing|ambiguous|disabled|moving|hidden|covered)|observation|focus|context|busy|foreground|page_changed|attach|transport)$/.test(code))?code:'';}
  function sanitizeFailures(list){
    return (Array.isArray(list)?list:[]).slice(0,40).flatMap((item,index)=>{
      if(!['SUCCESS','SKIPPED','RECOVERED','BLOCKED','FAILED_PRECHECK'].includes(item?.status)||!safeCode(item.code))return [];
      const out={fieldId:typeof item.fieldId==='string'&&/^field-\d+(?:-\d+)*$/.test(item.fieldId)?item.fieldId:'f'+(index+1),status:item.status,code:safeCode(item.code)};
      if(safeCode(item.primaryFailure))out.primaryFailure=safeCode(item.primaryFailure);
      if(safeCode(item.recoveryFailure))out.recoveryFailure=safeCode(item.recoveryFailure);
      const obs=item.observation;
      if(obs&&Object.values(STATES).includes(obs.state)){
        out.observation={state:obs.state,ownership:['none','semantic','local','mutation','appeared'].includes(obs.ownership)?obs.ownership:'none'};
        if(safeCode(obs.reason))out.observation.reason=safeCode(obs.reason);
        if(Number.isInteger(obs.popupCandidates))out.observation.popupCandidates=Math.max(0,Math.min(300,obs.popupCandidates));
        for(const key of ['popupOwned','ariaExpanded','ariaExpandedDeclared','observationLimited','observerActive'])if(typeof obs[key]==='boolean')out.observation[key]=obs[key];
        if(Array.isArray(obs.transitions))out.observation.transitions=obs.transitions.filter(t=>typeof t==='string'&&t.split('>').length===2&&t.split('>').every(s=>Object.values(STATES).includes(s))).slice(-16);
      }
      if(item.recovery){out.recovery={};for(const key of ['escapeAttempted','blurAttempted','closeControlAttempted','dismissAttempted','toggleAttempted'])if(typeof item.recovery[key]==='boolean')out.recovery[key]=item.recovery[key];}
      return [out];
    });
  }
  function create(config){
    const records=new WeakMap(),rootRecords=new WeakMap();
    const catalog=root.ResumeProControlCatalog;
    const semantic=catalog?.semantic?.popup||'[role="listbox"],[role="tree"],[role="grid"]';
    const selector=[semantic,config.panelSelector,catalog?.selector('datePanel')].filter(Boolean).join(',');
    const popupRoot=config.popupRoot||catalog?.popupRoot||(n=>n);
    function record(entry){
      if(!records.has(entry))records.set(entry,rootRecords.get(entry.root)||{state:STATES.CLOSED,history:[],before:new Map(),changed:new Set(),observer:null,overflow:false,hadPanel:false,closedSince:0,ownership:'none',candidates:0,waiters:new Set()});
      const r=records.get(entry);if(entry.root)rootRecords.set(entry.root,r);return r;
    }
    function transition(entry,state,reason=''){
      const r=record(entry);
      if(state!==r.state&&!NEXT[r.state]?.includes(state))throw new Error('控件交互状态异常，已停止');
      if(r.state!==state){r.history.push({from:r.state,to:state});r.history=r.history.slice(-16);}
      r.state=state;r.reason=reason;return state;
    }
    function displayed(node){
      if(!node?.isConnected||!config.visible(node)||node.closest('[hidden],[aria-hidden="true"],[inert]'))return false;
      let rect=node.getBoundingClientRect();
      for(let n=node;n&&n!==document.documentElement;n=n.parentElement||n.getRootNode().host){
        const style=getComputedStyle(n);
        if(style.display==='none'||style.visibility==='hidden'||style.visibility==='collapse'||Number(style.opacity)===0||style.contentVisibility==='hidden')return false;
        if(n!==node&&/(hidden|clip|auto|scroll)/.test(`${style.overflowX} ${style.overflowY}`)){
          const box=n.getBoundingClientRect();
          const left=/(hidden|clip|auto|scroll)/.test(style.overflowX)?Math.max(rect.left,box.left):rect.left;
          const right=/(hidden|clip|auto|scroll)/.test(style.overflowX)?Math.min(rect.right,box.right):rect.right;
          const top=/(hidden|clip|auto|scroll)/.test(style.overflowY)?Math.max(rect.top,box.top):rect.top;
          const bottom=/(hidden|clip|auto|scroll)/.test(style.overflowY)?Math.min(rect.bottom,box.bottom):rect.bottom;
          if(right<=left||bottom<=top)return false;
          rect={left,right,top,bottom};
        }
      }
      return true;
    }
    function painted(node){if(!displayed(node))return false;const r=node.getBoundingClientRect();return r.right>0&&r.bottom>0&&r.left<innerWidth&&r.top<innerHeight;}
    function beforeVisible(node){
      if(displayed(node))return true;
      const box=node.getBoundingClientRect();if(box.width<=0||box.height!==0)return false;
      // A CSS-visible empty async list existed before this click. Its later
      // population is not proof that this click created it.
      for(let n=node;n;n=n.parentElement||n.getRootNode().host){const style=getComputedStyle(n);
        if(n.matches('[hidden],[aria-hidden="true"],[inert]')||style.display==='none'||style.visibility==='hidden'||Number(style.opacity)===0)return false;}
      return true;
    }
    function evidence(node){
      if(!node||catalog?.isPopup(node)===false||node.matches('html,body,form,main,section,input,textarea,select,label'))return false;
      if(node.matches(semantic))return true;
      const specific=[catalog?.selector('selectPanel'),catalog?.selector('datePanel')].filter(Boolean).join(',');
      if(specific&&(node.matches(specific)||catalog?.selector('layerRoot')&&node.matches(catalog.selector('layerRoot'))&&node.querySelector(specific)))return true;
      if(node.querySelector(config.optionSelector))return true;
      if(!['absolute','fixed'].includes(getComputedStyle(node).position))return false;
      return structuralOptions(node,displayed).some(n=>!config.placeholder?.((n.getAttribute('aria-label')||n.textContent||'').trim()));
    }
    function eligible(entry,node){
      const input=config.localInput(entry);
      if(node&&config.displaySelector&&queryAll(entry.root,config.displaySelector).some(display=>display===node||display.contains(node)||node.contains(display)))return false;
      const local=node&&entry.opened&&entry.root.contains(node)&&structuralOptions(node,displayed).some(n=>!config.placeholder?.((n.getAttribute('aria-label')||n.textContent||'').trim()));
      return node&&(evidence(node)||local)&&displayed(node)&&!node.contains(entry.root)&&!node.contains(entry.trigger)&&!node.contains(input);
    }
    function candidates(){
      return outer(queryAll(document,selector).filter(n=>catalog?.isPopup(n)!==false).map(popupRoot).filter(n=>evidence(n)&&displayed(n)));
    }
    function hazards(){
      // An inline list/grid can be an ordinary page control. Without popup
      // ownership or a floating surface, its mere role cannot freeze a form.
      return candidates().filter(node=>{
        for(let n=node;n&&n!==document.body;n=n.parentElement)if(['absolute','fixed'].includes(getComputedStyle(n).position))return true;
        return node.id&&Array.from(document.querySelectorAll('[aria-controls][aria-expanded="true"],[aria-owns][aria-expanded="true"]'))
          .some(owner=>`${owner.getAttribute('aria-controls')||''} ${owner.getAttribute('aria-owns')||''}`.split(/\s+/).includes(node.id));
      });
    }
    function linked(entry){
      const owners=[entry.trigger,entry.root,...entry.root.querySelectorAll('[aria-controls],[aria-owns]')];
      const ids=new Set(owners.flatMap(n=>`${n.getAttribute('aria-controls')||''} ${n.getAttribute('aria-owns')||''}`.trim().split(/\s+/)).filter(Boolean));
      const ownerRoot=entry.root.getRootNode();
      return outer([...ids].map(id=>ownerRoot.getElementById?.(id)||document.getElementById(id)).filter(n=>eligible(entry,n)).map(popupRoot).filter(n=>eligible(entry,n)));
    }
    function floating(entry){
      if(!entry.structuralChoice&&!entry.opened)return [];
      return queryAll(entry.root,'*',300).filter(n=>eligible(entry,n));
    }
    function anchored(entry,node){
      const a=entry.trigger.getBoundingClientRect(),b=node.getBoundingClientRect();
      const gap=Math.min(Math.abs(b.top-a.bottom),Math.abs(a.top-b.bottom));
      return b.right>=a.left-24&&b.left<=a.right+24&&gap<=Math.max(96,a.height*2);
    }
    // Unknown portal shapes are observed only within this action's bounded DOM
    // changes. New nodes alone are insufficient: require options and anchoring.
    function changedCandidates(entry){
      const r=record(entry),pool=new Set();
      for(const changed of r.changed){
        if(!changed.isConnected)continue;
        let n=changed;
        for(let i=0;n&&i<6&&n!==document.body;i++,n=n.parentElement){
          if(eligible(entry,n))pool.add(popupRoot(n));
        }
      }
      return outer([...pool]).filter(n=>eligible(entry,n)&&!r.before.get(n)
        &&(n.matches(selector)||anchored(entry,n)));
    }
    function begin(entry){
      const r=record(entry);r.observer?.disconnect();r.changed.clear();r.overflow=false;r.hadPanel=false;r.closedSince=0;
      // Include existing classless floating surfaces in the baseline, so an
      // unrelated mutation cannot turn an old list into this control's popup.
      const baseline=queryAll(document,selector);
      for(const n of queryAll(document,'*',4000))if(['absolute','fixed'].includes(getComputedStyle(n).position))baseline.push(n);
      r.before=new Map(baseline.map(n=>[popupRoot(n),beforeVisible(popupRoot(n))]));
      r.observer=new MutationObserver(mutations=>{
        for(const mutation of mutations){
          const nodes=mutation.type==='childList'?[mutation.target,...mutation.addedNodes]:[mutation.target];
          for(const n of nodes){
            if(n.nodeType!==1)continue;
            if(r.changed.size>=512)for(const old of r.changed)if(!old.isConnected)r.changed.delete(old);
            if(r.changed.size>=512){r.overflow=true;break;}r.changed.add(n);
            // Shadow trees do not bubble mutations to the document observer.
            if(n.shadowRoot)observeRoot(n.shadowRoot);
            for(const child of Array.from(n.querySelectorAll('*')).slice(0,128))if(child.shadowRoot)observeRoot(child.shadowRoot);
          }
        }
        for(const wake of r.waiters)wake();
      });
      const roots=new Set();
      const observeRoot=scope=>{if(roots.has(scope)||roots.size>=24)return;roots.add(scope);r.observer.observe(scope,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['style','class','hidden','inert','aria-hidden','aria-expanded','aria-controls','aria-owns','aria-busy','aria-selected','checked']});};
      observeRoot(document.documentElement);
      for(const n of queryAll(document,'*',4000))if(n.shadowRoot)observeRoot(n.shadowRoot);
      if(entry.root.getRootNode()!==document)observeRoot(entry.root.getRootNode());
      transition(entry,STATES.OPENING);return r;
    }
    function loading(panel){
      const selector='[aria-busy="true"],[role="progressbar"],[class*="loading" i],[class*="skeleton" i],[class*="spinner" i]';
      return panel.matches(selector)&&displayed(panel)||queryAll(panel,selector,100).some(displayed)
        ||queryAll(panel,'div,span,li',100).some(n=>!n.children.length&&displayed(n)&&/^(?:加载中[.…]*|正在加载[.…]*|loading[.…]*)$/i.test(n.textContent.trim()));
    }
    async function settle(entry,read,{timeout=4000,quiet=140,allowEmpty=false}={}){
      const r=record(entry),deadline=Date.now()+timeout;let previous='',since=Date.now();
      do{
        const observed=inspect(entry),p=observed.panel,nodes=p?read(p):[];
        const motion=[];for(let n=p,depth=0;n&&depth<6;n=n.parentElement,depth++){const style=getComputedStyle(n);motion.push(style.opacity,style.transform);}
        const box=p?.getBoundingClientRect(),signature=JSON.stringify([Boolean(p),Boolean(p)&&loading(p),nodes.map(n=>[n.textContent.trim(),n.getAttribute('aria-disabled'),n.getAttribute('aria-selected')]),box&&[box.x,box.y,box.width,box.height].map(Math.round),motion]);
        // Node identity is tracked separately; JSON must never serialize DOM.
        if(signature!==previous||r.settlePanel!==p){previous=signature;r.settlePanel=p;since=Date.now();}
        if(p&&!observed.ambiguous&&!loading(p)&&(nodes.length||allowEmpty)&&Date.now()-since>=quiet)return {ready:true,panel:p,nodes};
        if(observed.ambiguous)return {ready:false,ambiguous:true,panel:null,nodes:[]};
        await new Promise(resolve=>{const wake=()=>{clearTimeout(timer);r.waiters.delete(wake);resolve();};const timer=setTimeout(wake,60);r.waiters.add(wake);});
      }while(Date.now()<deadline);
      return {ready:false,panel:inspect(entry).panel,nodes:[]};
    }
    function inspect(entry){
      const r=record(entry);entry.panelAmbiguous=false;
      if(!config.live(entry))return {panel:null,ambiguous:Boolean(entry.ownedPanel&&painted(entry.ownedPanel)),expanded:false};
      let pool=linked(entry),ownership='semantic';
      if(!pool.length){pool=outer([...Array.from(entry.root.querySelectorAll(selector)).map(popupRoot),...floating(entry)].filter(n=>eligible(entry,n)));ownership='local';}
      if(!pool.length&&entry.opened){
        pool=changedCandidates(entry);ownership='mutation';
        if(!pool.length){pool=candidates().filter(n=>eligible(entry,n)&&!r.before.get(n)&&!entry.beforePanels?.has(n));ownership='appeared';}
        if(!pool.length&&entry.ownedPanel?.isConnected&&eligible(entry,entry.ownedPanel)){pool=[entry.ownedPanel];ownership=r.ownership;}
      }
      r.candidates=pool.length;r.ownership=pool.length===1?ownership:'none';
      entry.panelAmbiguous=pool.length>1;
      const panel=pool.length===1?pool[0]:null;
      if(panel){entry.ownedPanel=panel;r.hadPanel=true;r.closedSince=0;if(r.state===STATES.OPENING)transition(entry,STATES.OPEN);}
      else if(entry.panelAmbiguous)r.closedSince=0;
      else if(!r.closedSince)r.closedSince=Date.now();
      const declared=entry.trigger.getAttribute('aria-expanded')==='true'||entry.root.getAttribute('aria-expanded')==='true';
      // A retained aria-expanded flag cannot override a panel that was observed
      // open and has now stayed physically closed across multiple samples.
      const expanded=declared&&!(r.hadPanel&&!panel&&!entry.panelAmbiguous&&Date.now()-r.closedSince>=160);
      return {panel,ambiguous:entry.panelAmbiguous,expanded};
    }
    function closed(entry){
      const observed=inspect(entry),r=record(entry);
      return !observed.panel&&!observed.ambiguous&&!observed.expanded&&Date.now()-r.closedSince>=160;
    }
    function finish(entry){
      const r=record(entry);r.observer?.disconnect();r.observer=null;r.changed.clear();r.before.clear();r.settlePanel=null;for(const wake of r.waiters)wake();transition(entry,STATES.CLOSED);
    }
    function pause(entry){const r=record(entry);r.observer?.disconnect();r.observer=null;}
    function snapshot(entry){
      const observed=inspect(entry),r=record(entry);
      return {state:r.state,reason:r.reason||'',ownership:r.ownership,popupCandidates:r.candidates,popupOwned:Boolean(observed.panel),ariaExpanded:observed.expanded,
        ariaExpandedDeclared:entry.root?.getAttribute('aria-expanded')==='true'||entry.trigger?.getAttribute('aria-expanded')==='true',
        observationLimited:r.overflow,observerActive:Boolean(r.observer),transitions:r.history.map(h=>`${h.from}>${h.to}`)};
    }
    async function continuation(blocker,target){
      const observed=inspect(blocker),r=record(blocker);
      const fail=(code,status='BLOCKED')=>({status,code,observation:snapshot(blocker)});
      if(observed.ambiguous||r.overflow||!observed.panel)return fail('POPUP_OWNERSHIP_UNCONFIRMED');
      const node=target.element||target.trigger;
      const dialogs=queryAll(document,'[aria-modal="true"],[role="dialog"],dialog[open]').filter(painted);
      if(dialogs.some(n=>n===observed.panel?n.getAttribute('aria-modal')==='true':!n.contains(blocker.root)||!n.contains(node)))return fail('PAGE_MODAL_BLOCKED');
      if(hazards().some(n=>n!==observed.panel&&!observed.panel.contains(n)))return fail('OTHER_POPUP_UNCONFIRMED');
      if(!node?.isConnected||blocker.root.contains(node)||observed.panel.contains(node))return fail('POPUP_TARGET_RELATED','SKIPPED');
      if(blocker.meta?.rangeId&&blocker.meta.rangeId===target.meta?.rangeId||blocker.meta?.cascadeGroup!==undefined&&blocker.meta.cascadeGroup===target.meta?.cascadeGroup)return fail('POPUP_TARGET_RELATED','SKIPPED');
      // Multiple complex popups cannot share a single unresolved transaction.
      // Only independent ordinary inputs are eligible for local continuation.
      const plain=target.kind==='element'&&!target.dateLike&&!target.pickerType&&node.matches('textarea,input:not([type]),input:is([type="text"],[type="email"],[type="tel"],[type="url"],[type="number"])')&&!node.readOnly;
      if(!plain)return fail('POPUP_COMPLEX_DEFERRED','SKIPPED');
      if(node.matches('[disabled],[aria-disabled="true"]')||node.closest('[inert]'))return fail('TARGET_DISABLED');
      const hit=()=>{
        if(!painted(node))return false;
        const box=node.getBoundingClientRect(),left=Math.max(0,box.left),right=Math.min(innerWidth,box.right),top=Math.max(0,box.top),bottom=Math.min(innerHeight,box.bottom);
        if(right<=left||bottom<=top)return false;
        return [[.5,.5],[.2,.2],[.8,.2],[.2,.8],[.8,.8]].some(([x,y])=>{const n=document.elementFromPoint(left+(right-left)*x,top+(bottom-top)*y);return n&&(n===node||node.contains(n));});
      };
      node.scrollIntoView({block:'center',behavior:'instant'});
      let previous='',stable=0;
      for(let i=0;i<10;i++){
        await wait(40);if(!node.isConnected)return fail('TARGET_REPLACED');
        const box=node.getBoundingClientRect(),position=[box.x,box.y,box.width,box.height].map(Math.round).join(',');
        stable=position===previous?stable+1:0;previous=position;if(stable>=2)break;
      }
      if(stable<2)return fail('TARGET_MOVING');
      if(!hit())return fail('TARGET_COVERED');
      node.focus({preventScroll:true});
      for(let i=0;i<2;i++){
        await wait(80);
        if(document.activeElement!==node)return fail('PAGE_FOCUS_LOCKED');
        if(!hit())return fail('TARGET_COVERED');
        if(inspect(blocker).ambiguous||hazards().some(n=>n!==observed.panel&&!observed.panel.contains(n)))return fail('OTHER_POPUP_UNCONFIRMED');
      }
      return {status:'SUCCESS',isolated:true,code:'LOCAL_POPUP_ISOLATED',observation:snapshot(blocker)};
    }
    return {begin,inspect,closed,settle,loading,finish,pause,transition,snapshot,candidates,hazards,displayed,painted,continuation,state:entry=>record(entry).state};
  }
  root.ResumeProPopupController={create,STATES,sanitizeFailures,queryAll,structuralOptions,optionColumns,choiceEnabled,syntheticClick};
  if(typeof module!=='undefined'&&module.exports)module.exports=root.ResumeProPopupController;
})(typeof self!=='undefined'?self:globalThis);
