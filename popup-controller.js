/* Popup ownership and lifecycle. Observations never contain applicant values. */
(function(root){
  'use strict';
  const STATES=Object.freeze({CLOSED:'CLOSED',OPENING:'OPENING',OPEN:'OPEN',SELECTING:'SELECTING',VERIFYING:'VERIFYING',RECOVERING:'RECOVERING',BLOCKED:'BLOCKED'});
  const NEXT={CLOSED:['OPENING','OPEN','RECOVERING','BLOCKED'],OPENING:['OPEN','SELECTING','VERIFYING','RECOVERING','CLOSED','BLOCKED'],
    OPEN:['OPENING','SELECTING','VERIFYING','RECOVERING','CLOSED','BLOCKED'],SELECTING:['OPENING','OPEN','VERIFYING','RECOVERING','CLOSED','BLOCKED'],
    VERIFYING:['OPENING','OPEN','SELECTING','RECOVERING','CLOSED','BLOCKED'],RECOVERING:['OPEN','CLOSED','BLOCKED'],BLOCKED:['OPENING','OPEN','RECOVERING','CLOSED']};
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const outer=nodes=>[...new Set(nodes)].filter(n=>!nodes.some(p=>p!==n&&p.contains(n)));
  const CODES=new Set(['VALUE_VERIFIED','VALUE_UNCONFIRMED','OPTION_COMMIT_UNCONFIRMED','POPUP_OWNERSHIP_UNCONFIRMED','POPUP_CLOSE_UNCONFIRMED','POPUP_RECOVERED',
    'PAGE_MODAL_BLOCKED','OTHER_POPUP_UNCONFIRMED','POPUP_TARGET_RELATED','POPUP_COMPLEX_DEFERRED','TARGET_DISABLED','TARGET_REPLACED','TARGET_MOVING','TARGET_COVERED','PAGE_FOCUS_LOCKED','LOCAL_POPUP_ISOLATED',
    'PRECISION_UNRESOLVED','HANDOFF_UNSAFE','PEER_CHANGED','STALL_DETECTED','BUDGET_EXCEEDED','AI_STOPPED','GENERIC_AGENT_UNAVAILABLE']);
  function safeCode(code){return typeof code==='string'&&(CODES.has(code)||/^input_(?:invalid|too_long|target_(?:missing|ambiguous|disabled|moving|hidden|covered)|observation|focus|context|busy|foreground|page_changed|attach|transport)$/.test(code))?code:'';}
  function sanitizeFailures(list){
    return (Array.isArray(list)?list:[]).slice(0,40).flatMap((item,index)=>{
      if(!['SUCCESS','SKIPPED','RECOVERED','BLOCKED'].includes(item?.status)||!safeCode(item.code))return [];
      const out={fieldId:typeof item.fieldId==='string'&&/^field-\d+(?:-\d+)*$/.test(item.fieldId)?item.fieldId:'f'+(index+1),status:item.status,code:safeCode(item.code)};
      const obs=item.observation;
      if(obs&&Object.values(STATES).includes(obs.state)){
        out.observation={state:obs.state,ownership:['none','semantic','local','mutation','appeared'].includes(obs.ownership)?obs.ownership:'none'};
        if(safeCode(obs.reason))out.observation.reason=safeCode(obs.reason);
        if(Number.isInteger(obs.popupCandidates))out.observation.popupCandidates=Math.max(0,Math.min(300,obs.popupCandidates));
        for(const key of ['popupOwned','ariaExpanded','ariaExpandedDeclared','observationLimited','observerActive'])if(typeof obs[key]==='boolean')out.observation[key]=obs[key];
        if(Array.isArray(obs.transitions))out.observation.transitions=obs.transitions.filter(t=>typeof t==='string'&&t.split('>').length===2&&t.split('>').every(s=>Object.values(STATES).includes(s))).slice(-16);
      }
      if(item.recovery){out.recovery={};for(const key of ['escapeAttempted','blurAttempted','dismissAttempted','toggleAttempted'])if(typeof item.recovery[key]==='boolean')out.recovery[key]=item.recovery[key];}
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
      if(!records.has(entry))records.set(entry,rootRecords.get(entry.root)||{state:STATES.CLOSED,history:[],before:new Map(),changed:new Set(),observer:null,overflow:false,hadPanel:false,closedSince:0,ownership:'none',candidates:0});
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
      for(let n=node;n&&n!==document.documentElement;n=n.parentElement){
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
    function evidence(node){
      if(!node||catalog?.isPopup(node)===false||node.matches('html,body,form,main,section,input,textarea,select,label'))return false;
      if(node.matches(semantic))return true;
      const specific=[catalog?.selector('selectPanel'),catalog?.selector('datePanel')].filter(Boolean).join(',');
      if(specific&&(node.matches(specific)||catalog?.selector('layerRoot')&&node.matches(catalog.selector('layerRoot'))&&node.querySelector(specific)))return true;
      if(node.querySelector(config.optionSelector))return true;
      if(!['absolute','fixed'].includes(getComputedStyle(node).position))return false;
      return Array.from(node.children).some(n=>n.textContent.trim()&&!n.matches('button,a,input,textarea,select,form')&&!n.querySelector('button,a,input,textarea,select,form')
        &&(n.matches('li,[role="option"],[tabindex]')||getComputedStyle(n).cursor==='pointer'));
    }
    function eligible(entry,node){
      const input=config.localInput(entry);
      return node&&evidence(node)&&displayed(node)&&!node.contains(entry.root)&&!node.contains(entry.trigger)&&!node.contains(input);
    }
    function candidates(){
      return outer(Array.from(document.querySelectorAll(selector)).filter(n=>catalog?.isPopup(n)!==false).map(popupRoot).filter(n=>evidence(n)&&displayed(n)));
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
      return outer([...ids].map(id=>document.getElementById(id)).filter(n=>eligible(entry,n)).map(popupRoot).filter(n=>eligible(entry,n)));
    }
    function floating(entry){
      if(!entry.structuralChoice)return [];
      return Array.from(entry.root.querySelectorAll('*')).filter(n=>['absolute','fixed'].includes(getComputedStyle(n).position)&&eligible(entry,n));
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
          if(evidence(n)&&eligible(entry,n))pool.add(popupRoot(n));
        }
      }
      return outer([...pool]).filter(n=>eligible(entry,n)&&!r.before.get(n)
        &&(n.matches(selector)||anchored(entry,n)));
    }
    function begin(entry){
      const r=record(entry);r.observer?.disconnect();r.changed.clear();r.overflow=false;r.hadPanel=false;r.closedSince=0;
      r.before=new Map(Array.from(document.querySelectorAll(selector)).map(n=>[popupRoot(n),displayed(popupRoot(n))]));
      r.observer=new MutationObserver(mutations=>{
        for(const mutation of mutations){
          const nodes=mutation.type==='childList'?[mutation.target,...mutation.addedNodes]:[mutation.target];
          for(const n of nodes){if(n.nodeType!==1)continue;if(r.changed.size>=256){r.overflow=true;break;}r.changed.add(n);}
        }
      });
      r.observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['style','class','hidden','inert','aria-hidden','aria-expanded','aria-controls','aria-owns']});
      transition(entry,STATES.OPENING);return r;
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
      const r=record(entry);r.observer?.disconnect();r.observer=null;r.changed.clear();r.before.clear();transition(entry,STATES.CLOSED);
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
      const dialogs=Array.from(document.querySelectorAll('[aria-modal="true"],[role="dialog"],dialog[open]')).filter(painted);
      if(dialogs.some(n=>n!==observed.panel||n.getAttribute('aria-modal')==='true'))return fail('PAGE_MODAL_BLOCKED');
      if(hazards().some(n=>n!==observed.panel&&!observed.panel.contains(n)))return fail('OTHER_POPUP_UNCONFIRMED');
      const node=target.element||target.trigger;
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
    return {begin,inspect,closed,finish,pause,transition,snapshot,candidates,hazards,painted,continuation,state:entry=>record(entry).state};
  }
  root.ResumeProPopupController={create,STATES,sanitizeFailures};
  if(typeof module!=='undefined'&&module.exports)module.exports=root.ResumeProPopupController;
})(typeof self!=='undefined'?self:globalThis);
