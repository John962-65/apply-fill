/* Bounded observe → act → verify controller. Never clicks page-wide text or form actions. */
(function(root){
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const norm=v=>String(v??'').replace(/[\s*＊：:]+/g,'').trim().toLowerCase();
  function create(config){
    const {visible,optionSelector,displaySelector,placeholder,refresh}=config;
    const panelSelector=config.panelSelector||"[role='listbox'],[role='tree'],[class*='select-dropdown'],[class*='select__dropdown'],[class*='select__menu'],[class*='select__list'],.phoenix-single-select-list,.phoenix-selectList,.phoenix-calendar";
    const popupRoot=config.popupRoot||root.ResumeProControlCatalog?.popupRoot||(n=>n);
    const dom=root.ResumeProPopupController;
    const phoenix=entry=>entry.root.matches('.phoenix-select,.phoenix-select__cont');
    const phoenixCalendar=p=>Boolean(p&&(p.matches('.phoenix-calendar')||p.querySelector('.phoenix-calendar')));
    let activeEntry=null;
    const observedOpen=new Map();
    const selectionProofs=new WeakMap();
    const uncommittedRoots=new WeakSet();
    const trace=(entry,action,detail='')=>{entry.interactions??=[];entry.interactions.push({action,detail});entry.interactions=entry.interactions.slice(-20);};
    const popup=root.ResumeProPopupController.create({visible,panelSelector,optionSelector,displaySelector,placeholder,popupRoot,live,localInput});
    const states=root.ResumeProPopupController.STATES;
    const rememberError=(entry,error)=>{if(/^input_(?:invalid|too_long|target_(?:missing|ambiguous|disabled|moving|hidden|covered)|observation|focus|context|busy|foreground|page_changed|attach|transport)$/.test(error?.code||''))entry.failureCode=error.code;};
    function live(entry){
      if(entry.root?.isConnected&&entry.trigger?.isConnected)return true;
      const next=refresh(entry);
      if(!next)return false;
      if(next.kind&&next.kind!=='combobox')return false;
      if(uncommittedRoots.has(entry.root))uncommittedRoots.add(next.root);
      entry.root=next.root;entry.trigger=next.trigger;return true;
    }
    function localInput(entry){
      const selector='input:is([type="text"],[type="search"],:not([type]))';
      const inputs=entry.root.matches(selector)?[entry.root]:Array.from(entry.root.querySelectorAll(selector)).filter(visible);
      return inputs.length===1?inputs[0]:null;
    }
    function tokens(entry){
      return Array.from(entry.root.querySelectorAll('input[type="hidden"]')).map(n=>({name:n.name||n.id,value:n.value}));
    }
    const tokenValue=list=>list.some(t=>String(t.value||'').trim());
    const pending=entry=>popup.inspect(entry).expanded;
    function closedCaption(entry,owned,input,stored,proof){
      if(owned||pending(entry))return '';
      if(stored.length&&!tokenValue(stored))return '';
      // Some selects clear the search input and render the chosen caption as a
      // sibling span/div. Read that visible caption, not input.value or popup text.
      const walker=document.createTreeWalker(entry.root,NodeFilter.SHOW_TEXT),captions=[];
      const exclude=`input,textarea,select,button,svg,[role="option"],[role="tooltip"],[aria-hidden="true"],[class*="help" i],[class*="error" i],[class*="hint" i],[class*="placeholder" i],[class*="arrow" i],[class*="caret" i],[class*="chevron" i],${panelSelector}`;
      for(let node=walker.nextNode();node;node=walker.nextNode()){
        const parent=node.parentElement,text=node.textContent.trim();
        if(!parent||!visible(parent)||parent.closest(exclude)||parent.closest('label')&&parent.closest('label')!==entry.root&&!parent.closest('label').contains(input)
          ||!text||placeholder(text)||norm(text)===norm(entry.meta?.label)||/^[▾▿▼▽⌄×✕]+$/.test(text))continue;
        captions.push(text);
      }
      const unique=[...new Set(captions)],value=entry.multipleChoice?unique.join(' / '):unique.length===1?unique[0]:'';
      // A mirrored editable search query is still a query. It needs the same
      // stored ID / completed-click proof as input.value itself.
      if(value&&input&&!input.readOnly&&norm(input.value)===norm(value)&&!tokenValue(stored)
        &&!(proof&&norm(proof.text)===norm(value)&&proof.tokens===JSON.stringify(stored)))return '';
      return value;
    }
    function read(entry){
      if(!live(entry))return '';
      // Phoenix's tipEle is rendered from selected state, including while its opacity animates.
      // calcEle and placeholder duplicate text for layout and never prove a selection.
      const owned=panel(entry);
      if(entry.structuralChoice){
        const input=localInput(entry),stored=tokens(entry),proof=entry.selectionProof||selectionProofs.get(entry.root);
        if(stored.length&&!tokenValue(stored))return '';
        if(owned||pending(entry)){
          if(input?.value?.trim()&&!tokenValue(stored)&&!proof)uncommittedRoots.add(entry.root);
          return '';
        }
        if(uncommittedRoots.has(entry.root)&&!tokenValue(stored)&&!proof)return '';
      }
      const shown=Array.from(entry.root.querySelectorAll(displaySelector)).filter(n=>(visible(n)||(phoenix(entry)&&n.matches('.phoenix-select__tipEle')))&&!n.closest(panelSelector)&&!owned?.contains(n));
      let value=shown.map(n=>n.textContent.trim()).filter(t=>t&&!placeholder(t)).join(' / ');
      if(!value&&!phoenix(entry)&&!entry.structuralChoice&&!owned&&!pending(entry)){
        const clone=entry.root.cloneNode(true);
        clone.querySelectorAll(`input,textarea,select,label,svg,button,${panelSelector}`).forEach(n=>n.remove());
        value=clone.textContent.trim();
      }
      // Editable input text is only a search query, never evidence that an option was chosen.
      if(!value&&entry.structuralChoice){
        const input=localInput(entry),typed=input?.value?.trim()||'',stored=tokens(entry);
        // A query left by an earlier fill is not a selection. A hidden selected ID,
        // or a completed option-click transaction, must survive popup closure.
        const proof=entry.selectionProof||selectionProofs.get(entry.root);
        value=closedCaption(entry,owned,input,stored,proof);
        if(!value&&typed&&!owned&&!pending(entry)&&(input.readOnly&&!stored.length||tokenValue(stored)||proof&&norm(proof.text)===norm(typed)
          &&JSON.stringify(stored)===proof.tokens))value=typed;
      }
      if(!value&&!entry.structuralChoice&&entry.trigger.matches('input[readonly]'))value=entry.trigger.value;
      return placeholder(value)?'':value;
    }
    function panels(){return popup.candidates();}
    function panel(entry){return popup.inspect(entry).panel;}
    function options(entry,scope=panel(entry)){
      if(!scope)return [];
      // Semantic options lead; platform selectors supplement missing ARIA.
      let nodes=dom.queryAll(scope,root.ResumeProControlCatalog?.semantic?.option||'[role="option"],[role="treeitem"]');
      if(!nodes.length)nodes=dom.queryAll(scope,optionSelector);
      if(entry.structuralChoice){
        nodes=Array.from(new Set([...nodes,...scope.querySelectorAll('li,[class*="option" i],[class*="item" i],[class*="suggestion" i]')]))
          .filter(n=>n.matches('li,[role="option"]')||!/(?:options|option[-_]?list|option[-_]?wrapper|suggestions|suggestion[-_]?list)/i.test(n.className||''));
        if(!nodes.length)nodes=dom.structuralOptions(scope,visible);
      }
      if(!nodes.length)nodes=dom.structuralOptions(scope,visible);
      return nodes.filter(n=>visible(n)&&popup.displayed(n)&&dom.choiceEnabled(n)
        &&!nodes.some(other=>other!==n&&other.contains(n))
        // The "add a school/major" footer is a form action, never a suggestion.
        &&(!entry.structuralChoice||!n.matches('a,button,input,form')&&!n.querySelector('a,button,input:not([type="checkbox"]),textarea,select,form')
          &&!/(?:没有找到|未找到|添加|新增|创建|删除|提交|保存|下一步)/.test(optionText(n))));
    }
    function optionText(n){return (n.getAttribute('aria-label')||n.textContent||'').trim();}
    async function click(node){
      if(!node?.isConnected||!visible(node)||node.matches('[disabled],[aria-disabled="true"]'))return false;
      const delegated=config.click?.(node);if(delegated)return await delegated;
      return dom.syntheticClick(node);
    }
    async function until(predicate,ms=1400){
      const end=Date.now()+ms;
      do {const value=predicate();if(value)return value;await wait(80);}while(Date.now()<end);
      return null;
    }
    async function close(entry,{committed=false}={}){
      const cleared=()=>{for(const [ownerRoot,owner] of observedOpen)if(owner===entry||owner.root===entry.root)observedOpen.delete(ownerRoot);entry.opened=false;entry.beforePanels=null;entry.ownedPanel=null;entry.phoenixDateInteraction=false;entry.popupBlocked=false;entry.recoveryFailureCode='';popup.finish(entry);if(activeEntry===entry)activeEntry=null;return true;};
      if(!live(entry)){
        if(entry.ownedPanel?.isConnected&&visible(entry.ownedPanel)){activeEntry=entry;entry.popupBlocked=true;popup.transition(entry,states.BLOCKED,'POPUP_OWNERSHIP_UNCONFIRMED');return false;}
        return cleared();
      }
      const owned=panel(entry);
      if(entry.structuralChoice&&(owned||pending(entry)||entry.opened)&&localInput(entry)?.value?.trim()
        &&!tokenValue(tokens(entry))&&!entry.selectionProof&&!selectionProofs.get(entry.root))uncommittedRoots.add(entry.root);
      if(!owned&&entry.panelAmbiguous){activeEntry=entry;entry.popupBlocked=true;popup.transition(entry,states.BLOCKED,'POPUP_OWNERSHIP_UNCONFIRMED');trace(entry,'关闭未完成','无法唯一确认关联面板');return false;}
      // An empty async popup can have zero height and no ARIA, but still be
      // waiting to render options. Dismiss every opening attempt before advancing.
      if(!owned&&!pending(entry)&&!entry.opened)return cleared();
      if(!owned&&!entry.panelAmbiguous&&popup.closed(entry))return cleared();
      // Give the component's own commit/exit transition time to settle before
      // focusing anything. Refocusing a search trigger can reopen or reset it.
      if(await until(()=>popup.closed(entry),committed?650:260))return cleared();
      activeEntry=entry;
      popup.transition(entry,states.RECOVERING);
      // Keep the Phoenix-specific recovery policy when its portal temporarily
      // disappears during a rerender. In particular, never fall back to a
      // trigger toggle that may now sit underneath a still-visible calendar.
      const phoenixPopup=phoenixCalendar(owned)||phoenixCalendar(entry.ownedPanel)||Boolean(entry.phoenixDateInteraction);
      const blockClose=detail=>{
        entry.popupBlocked=true;entry.recoveryFailureCode='POPUP_CLOSE_UNCONFIRMED';
        trace(entry,'关闭未完成',detail||'关联面板仍可见');
        popup.transition(entry,states.BLOCKED,'POPUP_CLOSE_UNCONFIRMED');return false;
      };
      entry.recoveryEvidence={escapeAttempted:true,blurAttempted:false,closeControlAttempted:false,dismissAttempted:false,toggleAttempted:false};
      const closed=()=>popup.closed(entry);
      try{
        const focused=document.activeElement;
        const escapeTarget=focused&&focused!==document.body&&(entry.root.contains(focused)||panel(entry)?.contains(focused))?focused:entry.trigger;
        const delegated=config.escape?.(escapeTarget);
        if(delegated)await delegated;
        else escapeTarget.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true,composed:true}));
      }catch(error){trace(entry,'关闭未完成',error.message);}
      if(!await until(closed,180)&&phoenixPopup){
        const scope=panel(entry);
        const closeControls=Array.from(scope?.querySelectorAll('.phoenix-calendar-close-btn,[aria-label],button,[role="button"],a')||[])
          .filter(n=>visible(n)&&!n.matches('[disabled],[aria-disabled="true"],[class*="disabled"]')
            &&(/^(关闭|close|dismiss|×|✕|✖)$/i.test((n.getAttribute('aria-label')||n.getAttribute('title')||n.textContent||'').trim())
              ||n.matches('.phoenix-calendar-close-btn')));
        if(closeControls.length===1){
          entry.recoveryEvidence.closeControlAttempted=true;
          try{await click(closeControls[0]);}catch(error){trace(entry,'关闭未完成',error.message);}
          if(await until(closed,600))return cleared();
        }
      }
      if(!await until(closed,300)&&!phoenixPopup&&panel(entry)&&!entry.panelAmbiguous){
        entry.recoveryEvidence.toggleAttempted=true;
        try{await click(entry.trigger);}catch(error){trace(entry,'关闭未完成',error.message);}
      }
      if(!await until(closed,300)&&config.dismiss&&!committed){
        entry.recoveryEvidence.dismissAttempted=true;
        try{await config.dismiss(entry.trigger);}catch(error){trace(entry,'关闭未完成',error.message);}
      }
      // React portals can close on the next render/animation frame. A subsequent control
      // must not be clicked through the preceding list. Only toggle our own confirmed trigger.
      if(!await until(closed,700)){
        if(phoenixPopup)return blockClose('凤凰日历未响应 Escape、内部关闭控件或安全区域操作；未点击可能被遮挡的触发器');
        return blockClose(entry.panelAmbiguous?'无法唯一确认残留弹层归属':'关联面板仍可见');
      }
      return cleared();
    }
    async function ready(entry){
      const owners=[...new Set([...observedOpen.values(),activeEntry].filter(Boolean))];
      for(const blocker of owners){
        if(blocker===entry||blocker.root===entry?.root){
          if(popup.state(blocker)===states.BLOCKED){
            if(panel(blocker)||blocker.panelAmbiguous){entry.popupBlocked=true;entry.recoveryFailureCode=blocker.recoveryFailureCode||'POPUP_CLOSE_UNCONFIRMED';return false;}
            if(!await close(blocker))return false;
          }
          continue;
        }
        if(popup.state(blocker)===states.BLOCKED&&panel(blocker)){
          if(entry){entry.popupBlocked=true;entry.recoveryFailureCode=blocker.recoveryFailureCode||'POPUP_CLOSE_UNCONFIRMED';entry.fillNote='前一控件的候选列表仍未关闭，已暂停后续填写';}
          return false;
        }
        if(!await close(blocker)){
          if(entry){entry.popupBlocked=true;entry.recoveryFailureCode=blocker.recoveryFailureCode||'POPUP_CLOSE_UNCONFIRMED';entry.fillNote='前一控件的候选列表仍未关闭，已暂停后续填写';}
          return false;
        }
      }
      return true;
    }
    async function prepare(entry){
      if(activeEntry&&activeEntry!==entry&&popup.state(activeEntry)!==states.BLOCKED)await ready(entry);
      if(!activeEntry){
        // A pre-existing, unowned popup or modal is never silently ignored by
        // the production scheduler. Passive scanning adopts known owners.
        const node=entry.element||entry.trigger;
        if(popup.hazards().length||dom.queryAll(document,'[aria-modal="true"],[role="dialog"],dialog[open]').some(n=>popup.painted(n)&&!n.contains(node)))return {status:'BLOCKED',code:'OTHER_POPUP_UNCONFIRMED'};
        return {status:'SUCCESS'};
      }
      if(activeEntry===entry||entry.kind==='combobox'&&activeEntry.root===entry.root){
        if(popup.state(activeEntry)===states.BLOCKED){
          if(panel(activeEntry)||activeEntry.panelAmbiguous)return {status:'SKIPPED',code:'POPUP_TARGET_RELATED',blocker:activeEntry};
          if(await close(activeEntry))return {status:'RECOVERED',code:'POPUP_RECOVERED'};
          return {status:'BLOCKED',code:'POPUP_CLOSE_UNCONFIRMED',blocker:activeEntry};
        }
      }
      if(activeEntry===entry)return {status:'SUCCESS'};
      if(entry.kind==='combobox'&&activeEntry.root===entry.root){
        // A new user-initiated fill can retry the same uniquely located owner;
        // it must not be mistaken for an unrelated subsequent control.
        entry.opened=activeEntry.opened;entry.ownedPanel=activeEntry.ownedPanel;entry.beforePanels=activeEntry.beforePanels;
        activeEntry=entry;return {status:'SUCCESS'};
      }
      const blocker=activeEntry;
      // Do not repeat the same failed cleanup for every subsequent field. A
      // disappeared panel can still be recovered after a manual dismissal.
      if(popup.state(blocker)!==states.BLOCKED||!panel(blocker)&&!blocker.panelAmbiguous){
        if(await close(blocker))return {status:'RECOVERED',code:'POPUP_RECOVERED'};
      }
      const result=await popup.continuation(blocker,entry);
      if(result.isolated)trace(entry,'局部继续','目标稳定、未遮挡且焦点可切换');
      return {...result,blocker};
    }
    function result(entry,ok,code=''){
      entry.interactionResult={status:ok?'SUCCESS':entry.popupBlocked?'BLOCKED':'RECOVERED',code:entry.failureCode||entry.recoveryFailureCode||code|| (ok?'VALUE_VERIFIED':entry.popupBlocked?'POPUP_CLOSE_UNCONFIRMED':'VALUE_UNCONFIRMED'),
        ...(entry.failureCode?{primaryFailure:entry.failureCode}:{}),...(entry.recoveryFailureCode?{recoveryFailure:entry.recoveryFailureCode}:{}),
        observation:popup.snapshot(entry),recovery:{...entry.recoveryEvidence}};
      return ok;
    }
    function adoptPanel(entry,related){
      if(!entry.opened||!entry.beforePanels)entry.beforePanels=new Set(panels().filter(p=>p!==related));
      entry.ownedPanel=related;entry.opened=true;activeEntry=entry;
      observedOpen.set(entry.root,entry);
      if(popup.state(entry)!==states.BLOCKED)popup.transition(entry,states.OPEN);
    }
    function observe(entry){
      const related=panel(entry);
      if(related){
        const previous=activeEntry;adoptPanel(entry,related);if(previous)activeEntry=previous;
      }else if(pending(entry)){
        // A preopened async menu can still be empty. Its explicit owner must
        // be recovered before a new control is opened, rather than letting its
        // later-loaded list be attributed to the next click.
        entry.beforePanels??=new Set(panels());entry.opened=true;observedOpen.set(entry.root,entry);
        if(!activeEntry)activeEntry=entry;
      }
      return related?options(entry):[];
    }
    async function open(entry){
      if(!live(entry))return [];
      if(!await ready(entry))throw new Error('前一控件的候选列表仍未关闭，已暂停后续填写');
      // Existing related popup is valid; don't toggle it closed.
      const related=panel(entry);
      if(related){
        if(!popup.snapshot(entry).observerActive)popup.begin(entry);
        adoptPanel(entry,related);
        await popup.settle(entry,p=>options(entry,p).length?options(entry,p):searchInput(entry)?[searchInput(entry)]:[],{timeout:3500});return options(entry);
      }
      if(entry.panelAmbiguous)throw new Error('无法唯一确认当前控件的候选列表');
      const wasPending=pending(entry);
      entry.beforePanels=new Set(panels());entry.ownedPanel=null;entry.opened=true;popup.begin(entry);
      activeEntry=entry;
      trace(entry,'打开');
      if(!wasPending)await click(entry.trigger);
      await popup.settle(entry,p=>dateAgent?.recognizes(p)?[p]:options(entry,p).length?options(entry,p):searchInput(entry)?[searchInput(entry)]:[],{timeout:3500});
      const found=options(entry);trace(entry,'观察',`读取 ${found.length} 个选项`);return found;
    }
    function unique(pool,wanted,entry){
      if(entry?.meta?.datePart||root.ResumeProAIHelpers.selectEnumTopic(entry?.meta))return pool.filter(n=>root.ResumeProAIHelpers.findSelectOptionIndex([optionText(n)],wanted,entry.meta)>=0);
      const exact=pool.filter(n=>norm(optionText(n))===norm(wanted));
      if(exact.length)return exact;
      if(/籍贯|生源地|户口|城市|地区|省市|工作地|居住|地址|所在地/.test(entry?.meta?.label||'')){
        const region=text=>norm(text).replace(/(?:壮族自治区|回族自治区|维吾尔自治区|自治区|特别行政区|省|市)$/,'');
        const target=region(wanted);
        if(target.length>=2)return pool.filter(n=>region(optionText(n))===target);
      }
      // Substrings are not identity: 选项4 must not match 选项49, and a broader
      // major/category must not replace a sourced specific major.
      return [];
    }
    async function scroll(entry,pool=options(entry)){
      const p=panel(entry);if(!p)return false;
      const scroller=[p,...dom.queryAll(p,'*',500)].filter(n=>visible(n)&&n.clientHeight>20&&n.scrollHeight>n.clientHeight+4
        &&/(auto|scroll)/.test(getComputedStyle(n).overflowY)&&pool.some(option=>n.contains(option)))
        .sort((a,b)=>a.contains(b)?1:b.contains(a)?-1:0)
        .find(n=>n.scrollTop+n.clientHeight<n.scrollHeight-2);
      if(!scroller)return false;
      const before=scroller.scrollTop;
      scroller.scrollTop=Math.min(scroller.scrollHeight-scroller.clientHeight,before+Math.max(20,scroller.clientHeight*.8));
      if(scroller.scrollTop<=before)return false;
      scroller.dispatchEvent(new Event('scroll',{bubbles:true}));
      await new Promise(resolve=>requestAnimationFrame(()=>resolve()));
      await popup.settle(entry,p=>options(entry,p),{timeout:1600});trace(entry,'滚动','重新采集当前可见选项');return true;
    }
    function searchInput(entry){
      const selector='input:is([type="text"],[type="search"],:not([type])):not([readonly]):not([disabled]):not(.phoenix-select__input--unText)';
      const local=entry.root.matches(selector)?[entry.root]:dom.queryAll(entry.root,selector).filter(visible);
      if(local.length===1&&visible(local[0]))return local[0];
      // Phoenix places the editable search in the owning portal, not in its non-search trigger.
      const remote=dom.queryAll(panel(entry),selector).filter(visible);
      return remote.length===1?remote[0]:null;
    }
    async function search(entry,wanted){
      const input=searchInput(entry);
      if(!input||!visible(input))return false;
      popup.transition(entry,states.SELECTING);
      uncommittedRoots.add(entry.root);entry.selectionProof=null;selectionProofs.delete(entry.root);
      const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
      const part=root.ResumeProAIHelpers.normalizeDatePart(wanted,entry.meta?.datePart);
      const query=part?String(Number(part)):String(wanted);
      const delegated=config.input?.(input,query);
      if(delegated)await delegated;else {input.focus();setter.call(input,query);input.dispatchEvent(new InputEvent('input',{bubbles:true,composed:true,data:query,inputType:'insertText'}));}
      trace(entry,'搜索',query!==String(wanted)?`${wanted} → ${query}`:'');entry.remoteOptions=true;
      await until(()=>unique(options(entry),wanted,entry).length>0,3500);
      await popup.settle(entry,p=>options(entry,p),{timeout:1600,allowEmpty:true});return true;
    }
    async function choose(entry,node,value){
      const selectedText=optionText(node),before=tokens(entry),hadToken=before.length>0;
      entry.selectionProof=null;
      selectionProofs.delete(entry.root);
      if(entry.structuralChoice)uncommittedRoots.add(entry.root);
      popup.transition(entry,states.SELECTING);
      if(!await click(node))return false;
      popup.transition(entry,states.VERIFYING);
      // Editable autocomplete controls often render the chosen caption in the same input.
      // When a stored ID exists it must actually change; otherwise require automatic menu
      // closure caused by this option click, before any forced Escape/blur cleanup.
      const success=await until(()=>{
        if(!live(entry))return false;
        // A visible caption is insufficient when this widget also exposes a
        // stored selected ID that the click never committed.
        const stored=tokens(entry);
        if(entry.structuralChoice&&hadToken&&(!tokenValue(stored)||JSON.stringify(before)===JSON.stringify(stored)))return false;
        if(entry.structuralChoice){
          // A forced Escape must never turn query text into successful selection.
          // This single-select popup must close because the option was clicked.
          if(!popup.closed(entry))return false;
          const input=localInput(entry),caption=closedCaption(entry,null,input,stored,null);
          const selected=caption||input?.value?.trim()||'';
          if(norm(selected)!==norm(selectedText)&&norm(selected)!==norm(value))return false;
          entry.selectionProof={text:selected,tokens:JSON.stringify(stored)};
          selectionProofs.set(entry.root,entry.selectionProof);uncommittedRoots.delete(entry.root);
          return true;
        }
        const shown=read(entry);
        if(norm(shown)===norm(selectedText)||norm(shown)===norm(value))return true;
        return false;
      },4000);
      if(!success)return false;
      entry.choiceCommitted=true;
      if(!await close(entry,{committed:true}))return false;
      await wait(180);
      const shown=read(entry);
      const retained=norm(shown)===norm(selectedText)||norm(shown)===norm(value);
      if(!retained)entry.choiceCommitted=false;
      return retained;
    }
    function multiple(entry,p=panel(entry)){
      return Boolean(entry.root.matches('[aria-multiselectable="true"]')||p&&(p.matches('[aria-multiselectable="true"]')
        ||p.querySelector('[aria-multiselectable="true"],[role="option"] input[type="checkbox"],[role="option"] [role="checkbox"]')));
    }
    function levelOptions(entry,level,parts){
      const all=options(entry),columns=dom.optionColumns(all);
      return !multiple(entry)&&parts.length>1&&columns.length>1?(columns[level]||[]):all;
    }
    const signature=nodes=>JSON.stringify(nodes.map(n=>optionText(n)));
    async function decideOption(entry,pool,wanted){
      if(!entry.decide||!pool.length||pool.length>60||new Set(pool.map(n=>norm(optionText(n)))).size!==pool.length)return null;
      const before=signature(pool),candidates=[{id:'stop',kind:'stop',label:'没有等价选项，停止'},
        ...pool.map((n,index)=>({id:'option-'+index,kind:'choose',label:optionText(n),index}))];
      const action=root.ResumeProInteractionAgent.validate(await entry.decide({mode:'choose-option',fieldLabel:entry.meta?.label||'',
        resumeValue:wanted,target:wanted,levelTarget:wanted,options:pool.map((n,index)=>({id:'option-'+index,text:optionText(n)})),candidates}),candidates);
      if(action.kind==='stop')return null;
      // Only an index in this observed list is accepted. No DOM references are
      // retained across the request; the caller checks the list again.
      trace(entry,'AI 单步选项','仅从已观察的等价候选中选择');return {text:optionText(pool[action.index]),before};
    }
    async function fillRules(entry,value){
      const strict=entry.meta?.datePart||root.ResumeProAIHelpers.selectEnumTopic(entry.meta);
      const start=Date.now();
      const fail=async(note,code='')=>{if(code)entry.failureCode||=code;entry.fillNote=note;trace(entry,'停止',note);
        if(!entry.popupBlocked)await close(entry);return result(entry,false,code);};
      if(!live(entry))return fail('控件已替换，无法唯一定位');
      if(read(entry))return fail('控件已有内容，未覆盖');
      const query=entry.structuralChoice?localInput(entry)?.value?.trim():'';
      const dateQuery=entry.meta?.datePart&&root.ResumeProAIHelpers.normalizeDatePart(query,entry.meta.datePart);
      if(query&&norm(query)!==norm(value)&&!dateQuery)return fail('输入框已有未确认的搜索文字，请先核对，未覆盖');
      await open(entry);
      const isMulti=multiple(entry);entry.multipleChoice=isMulti;
      const parts=options(entry).some(n=>norm(optionText(n))===norm(value))?[String(value).trim()]
        :String(value).split(isMulti?/[\/／、,，]/:/[\/／>＞→]/).map(s=>s.trim()).filter(Boolean);
      if(!parts.length||parts.length>8)return fail('选项层级或数量不明确');
      if(dateQuery&&dateQuery!==root.ResumeProAIHelpers.normalizeDatePart(value,entry.meta.datePart))await search(entry,value);
      for(let level=0;level<parts.length;level++){
        const wanted=parts[level];let searched=false,asked=false,clicked=false;
        for(let step=0;step<70&&Date.now()-start<25000;step++){
          if(!live(entry))return fail('控件已替换，无法唯一定位');
          if(entry.panelAmbiguous)return fail('存在多个候选弹层，无法确认当前选项归属','POPUP_OWNERSHIP_UNCONFIRMED');
          const settled=await popup.settle(entry,p=>options(entry,p),{timeout:1800,allowEmpty:true});
          if(!settled.ready){
            if(entry.panelAmbiguous)return fail('存在多个候选弹层，无法确认当前选项归属','POPUP_OWNERSHIP_UNCONFIRMED');
            // Some autocompletes mount their first portal only after typing.
            // The already-open owner may supply that search capability itself.
            if(!panel(entry)&&!searched&&searchInput(entry)){searched=true;await search(entry,wanted);}
            continue;
          }
          let pool=levelOptions(entry,level,parts),matches=unique(pool,wanted,entry);
          if(pool.length)entry.observedOptions=[...new Set([...(entry.observedOptions||[]),...pool.map(optionText)])].slice(-100);
          if(matches.length>1)return fail('存在多个同名选项，未猜测');
          if(!matches.length){
            if(!searched){searched=true;if(await search(entry,wanted))continue;}
            if(await scroll(entry,pool))continue;
            if(!pool.length){
              if(await until(()=>levelOptions(entry,level,parts).length||entry.panelAmbiguous,2000))continue;
              return fail('候选列表未完成加载或未识别到可验证选项');
            }
            if(!strict&&!asked&&entry.decide){
              asked=true;const choice=await decideOption(entry,pool,wanted);
              const fresh=levelOptions(entry,level,parts);
              if(choice&&signature(fresh)===choice.before){matches=fresh.filter(n=>optionText(n)===choice.text);pool=fresh;}
              else if(choice){trace(entry,'重新观察','模型等待期间选项变化，未使用旧索引');continue;}
            }
            if(matches.length!==1){
              entry.fillIssue='choice-mismatch';
              return fail(`资料值“${wanted}”没有唯一等价选项，请人工确认；页面选项：${(entry.observedOptions||[]).join('、')}`);
            }
          }
          const selectedText=optionText(matches[0]);
          const fresh=levelOptions(entry,level,parts).filter(n=>optionText(n)===selectedText);
          if(fresh.length!==1)continue;
          trace(entry,'选择',`第 ${level+1} 级：${selectedText}`);clicked=true;
          if(isMulti){
            const selected=n=>n.getAttribute('aria-selected')==='true'||n.getAttribute('aria-checked')==='true'
              ||Boolean(n.querySelector('input[type="checkbox"]:checked,[role="checkbox"][aria-checked="true"]'));
            popup.transition(entry,states.SELECTING);
            if(!selected(fresh[0])&&!await click(fresh[0]))return fail('多选项未能安全点击','OPTION_COMMIT_UNCONFIRMED');
            if(!await until(()=>options(entry).some(n=>optionText(n)===selectedText&&selected(n)),3500))return fail('未确认多选项进入选中状态','OPTION_COMMIT_UNCONFIRMED');
            popup.transition(entry,states.OPEN);break;
          }
          if(level<parts.length-1){
            const previousNodes=levelOptions(entry,level+1,parts),previous=signature(previousNodes),oldPanel=panel(entry),oldColumns=dom.optionColumns(options(entry)).length;
            const parentWasSelected=fresh[0].getAttribute('aria-selected')==='true';
            popup.transition(entry,states.SELECTING);
            if(!await click(fresh[0]))return fail('级联选项未能安全点击','OPTION_COMMIT_UNCONFIRMED');
            const advanced=await until(()=>{
              const next=levelOptions(entry,level+1,parts);
              return next.length&&(panel(entry)!==oldPanel||!fresh[0].isConnected||next.some(n=>!previousNodes.includes(n))
                ||signature(next)!==previous||dom.optionColumns(options(entry)).length>oldColumns
                ||parentWasSelected&&fresh[0].getAttribute('aria-selected')==='true'&&unique(next,parts[level+1],entry).length===1);
            },4000);
            if(!advanced)return fail('点击父级后未确认对应子列更新','OPTION_COMMIT_UNCONFIRMED');
            await popup.settle(entry,p=>options(entry,p),{timeout:1800});popup.transition(entry,states.OPEN);break;
          }
          let success;
          try{success=await choose(entry,fresh[0],value);}
          catch(error){
            if(error.code==='input_target_missing'&&live(entry)&&levelOptions(entry,level,parts).filter(n=>optionText(n)===selectedText).length===1){trace(entry,'重新观察','候选在点击前被替换');clicked=false;continue;}
            rememberError(entry,error);return fail(error.message);
          }
          if(success){entry.verifiedChoice=read(entry);entry.fillNote='';trace(entry,'核对','页面保留选中内容');return result(entry,true);}
          if(entry.choiceCommitted)return fail('目标选项已读回，但弹层未能安全关闭');
          return fail('点击后未确认选中；搜索文字不算选择成功','OPTION_COMMIT_UNCONFIRMED');
        }
        if(!clicked)return fail('选项查找达到时间或滚动步数上限');
      }
      if(isMulti){
        // Checked state is evidence of selection; search input alone never is.
        entry.selectionProof={text:parts.join(' / '),tokens:JSON.stringify(tokens(entry))};selectionProofs.set(entry.root,entry.selectionProof);uncommittedRoots.delete(entry.root);
        if(!await close(entry,{committed:true}))return false;
        await wait(180);
        const actual=read(entry),chosen=actual.split(/\s*[\/／]\s*/).map(norm);
        if(chosen.length===parts.length&&parts.every(part=>chosen.includes(norm(part)))){
          entry.verifiedChoice=actual;entry.fillNote='';trace(entry,'核对','页面保留全部目标选项');return true;
        }
        return fail('多选关闭后读回与目标不一致','OPTION_COMMIT_UNCONFIRMED');
      }
      return fail('交互次数或等待时间达到上限');
    }
    async function fillControl(entry,value){
      if(!await ready(entry))return false;
      if(live(entry)&&phoenix(entry)&&!read(entry)){
        try{
          await open(entry);
          if(dateAgent?.recognizes(panel(entry))){
            entry.phoenixDateInteraction=true;
            const ok=await dateAgent.fill(entry,value);
            const closed=entry.popupBlocked&&entry.recoveryFailureCode?false:await close(entry);
            if(!closed)entry.fillNote=[entry.fillNote,'日历仍未关闭，已暂停后续填写'].filter(Boolean).join('；');
            return ok&&closed;
          }
        }catch(error){rememberError(entry,error);entry.fillNote=error.message;await close(entry);return false;}
      }
      try{return await fillRules(entry,value);}
      catch(error){rememberError(entry,error);entry.fillNote=error.message;trace(entry,'停止',error.message);if(!entry.popupBlocked)await close(entry);return false;}
    }
    async function fill(entry,value){
      entry.interactionResult=null;entry.recoveryEvidence={};entry.failureCode='';entry.recoveryFailureCode='';entry.popupBlocked=false;
      entry.interactions=[];entry.verifiedChoice='';entry.fillIssue='';entry.observedOptions=[];entry.choiceCommitted=false;
      const ok=await fillControl(entry,value);
      return result(entry,ok,entry.interactionResult?.code||'');
    }
    const dateAgent=root.ResumeProPhoenixDateAgent?.create({visible,panel,read,click,close,trace,until,
      isClosed:entry=>popup.closed(entry),readPeer:entry=>entry.rangePeer?config.readPeer?.(entry.rangePeer):undefined});
    return {read,panel,options,observe,open,close,fill,ready,prepare,pending,observation:popup.snapshot,blocking:()=>activeEntry,suspend:()=>{if(activeEntry)popup.pause(activeEntry);}};
  }
  root.ResumeProComboAgent={create};
})(typeof self!=='undefined'?self:globalThis);
