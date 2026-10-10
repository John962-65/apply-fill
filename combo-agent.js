/* Bounded observe → act → verify controller. Never clicks page-wide text or form actions. */
(function(root){
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const norm=v=>String(v??'').replace(/[\s*＊：:]+/g,'').trim().toLowerCase();
  function create(config){
    const {visible,optionSelector,displaySelector,placeholder,refresh}=config;
    const panelSelector=config.panelSelector||"[role='listbox'],[role='tree'],[class*='select-dropdown'],[class*='select__dropdown'],[class*='select__menu'],[class*='select__list'],.phoenix-single-select-list,.phoenix-selectList,.phoenix-calendar";
    const popupRoot=config.popupRoot||root.ResumeProControlCatalog?.popupRoot||(n=>n);
    const phoenix=entry=>entry.root.matches('.phoenix-select,.phoenix-select__cont');
    let activeEntry=null;
    const selectionProofs=new WeakMap();
    const uncommittedRoots=new WeakSet();
    const trace=(entry,action,detail='')=>{entry.interactions??=[];entry.interactions.push({action,detail});entry.interactions=entry.interactions.slice(-20);};
    const popup=root.ResumeProPopupController.create({visible,panelSelector,optionSelector,popupRoot,live,localInput});
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
      const unique=[...new Set(captions)],value=unique.length===1?unique[0]:'';
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
      if(!value&&!phoenix(entry)&&!entry.structuralChoice){
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
    function options(entry){
      const scope=panel(entry);if(!scope)return [];
      // Semantic options lead; platform selectors supplement missing ARIA.
      let nodes=Array.from(scope.querySelectorAll(root.ResumeProControlCatalog?.semantic?.option||'[role="option"],[role="treeitem"]'));
      if(!nodes.length)nodes=Array.from(scope.querySelectorAll(optionSelector));
      if(entry.structuralChoice){
        nodes=Array.from(new Set([...nodes,...scope.querySelectorAll('li,[class*="option" i],[class*="item" i],[class*="suggestion" i]')]))
          .filter(n=>n.matches('li,[role="option"]')||!/(?:options|option[-_]?list|option[-_]?wrapper|suggestions|suggestion[-_]?list)/i.test(n.className||''));
        if(!nodes.length)nodes=Array.from(scope.children);
      }
      return nodes.filter(n=>visible(n)&&!n.closest('[aria-hidden="true"]')&&!n.closest('[disabled],[aria-disabled="true"],[class*="--disabled"],[class*="-disabled"]')
        &&!nodes.some(other=>other!==n&&other.contains(n))
        // The "add a school/major" footer is a form action, never a suggestion.
        &&(!entry.structuralChoice||!n.matches('a,button,input,form')&&!n.querySelector('a,button,input,textarea,select,form')
          &&!/(?:没有找到|未找到|添加|新增|创建|删除|提交|保存|下一步)/.test(optionText(n))));
    }
    function optionText(n){return (n.getAttribute('aria-label')||n.textContent||'').trim();}
    async function click(node){
      if(!node?.isConnected||!visible(node)||node.matches('[disabled],[aria-disabled="true"]'))return false;
      const delegated=config.click?.(node);if(delegated)return await delegated;
      node.scrollIntoView({block:'nearest'});
      node.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true}));
      node.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,cancelable:true}));
      node.click();return true;
    }
    async function until(predicate,ms=1400){
      const end=Date.now()+ms;
      do {const value=predicate();if(value)return value;await wait(80);}while(Date.now()<end);
      return null;
    }
    async function close(entry){
      const cleared=()=>{entry.opened=false;entry.beforePanels=null;entry.ownedPanel=null;entry.popupBlocked=false;popup.finish(entry);if(activeEntry===entry)activeEntry=null;return true;};
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
      activeEntry=entry;
      popup.transition(entry,states.RECOVERING);
      entry.recoveryEvidence={escapeAttempted:true,blurAttempted:false,dismissAttempted:false,toggleAttempted:false};
      const closed=()=>popup.closed(entry);
      try{
        const delegated=config.escape?.(entry.trigger);
        if(delegated)await delegated;
        else{
          entry.trigger.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true}));
          document.body.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));
        }
        localInput(entry)?.blur();entry.trigger.blur?.();entry.recoveryEvidence.blurAttempted=true;
      }catch(error){trace(entry,'关闭未完成',error.message);}
      if(!await until(closed,180)&&config.dismiss){
        entry.recoveryEvidence.dismissAttempted=true;
        try{await config.dismiss(entry.trigger);}catch(error){trace(entry,'关闭未完成',error.message);}
      }
      // React portals can close on the next render/animation frame. A subsequent control
      // must not be clicked through the preceding list. Only toggle our own confirmed trigger.
      if(!await until(closed,700)){
        entry.recoveryEvidence.toggleAttempted=true;
        try{await click(entry.trigger);}catch(error){trace(entry,'关闭未完成',error.message);entry.popupBlocked=true;popup.transition(entry,states.BLOCKED,'POPUP_CLOSE_UNCONFIRMED');return false;}
        if(!await until(closed,700)){trace(entry,'关闭未完成','关联面板仍可见');entry.popupBlocked=true;popup.transition(entry,states.BLOCKED,'POPUP_CLOSE_UNCONFIRMED');return false;}
      }
      return cleared();
    }
    async function ready(entry){
      if(activeEntry&&activeEntry!==entry&&!await close(activeEntry)){
        if(entry){entry.popupBlocked=true;entry.fillNote='前一控件的候选列表仍未关闭，已暂停后续填写';}
        return false;
      }
      return true;
    }
    async function prepare(entry){
      if(!activeEntry){
        // A pre-existing, unowned popup or modal is never silently ignored by
        // the production scheduler. Passive scanning adopts known owners.
        if(popup.hazards().length||Array.from(document.querySelectorAll('[aria-modal="true"],[role="dialog"],dialog[open]')).some(popup.painted))return {status:'BLOCKED',code:'OTHER_POPUP_UNCONFIRMED'};
        return {status:'SUCCESS'};
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
      entry.interactionResult={status:ok?'SUCCESS':entry.popupBlocked?'BLOCKED':'RECOVERED',code:entry.failureCode||code|| (ok?'VALUE_VERIFIED':entry.popupBlocked?'POPUP_CLOSE_UNCONFIRMED':'VALUE_UNCONFIRMED'),
        observation:popup.snapshot(entry),recovery:{...entry.recoveryEvidence}};
      return ok;
    }
    function adoptPanel(entry,related){
      if(!entry.opened||!entry.beforePanels)entry.beforePanels=new Set(panels().filter(p=>p!==related));
      entry.ownedPanel=related;entry.opened=true;activeEntry=entry;
      popup.transition(entry,states.OPEN);
    }
    function observe(entry){
      const related=panel(entry);
      if(related&&!activeEntry)adoptPanel(entry,related);
      return related?options(entry):[];
    }
    async function open(entry){
      if(!live(entry))return [];
      if(!await ready(entry))throw new Error('前一控件的候选列表仍未关闭，已暂停后续填写');
      // Existing related popup is valid; don't toggle it closed.
      const related=panel(entry);
      if(related){
        adoptPanel(entry,related);return options(entry);
      }
      if(entry.panelAmbiguous)throw new Error('无法唯一确认当前控件的候选列表');
      const wasPending=pending(entry);
      entry.beforePanels=new Set(panels());entry.ownedPanel=null;entry.opened=true;popup.begin(entry);
      activeEntry=entry;
      trace(entry,'打开');
      if(!wasPending){entry.trigger.focus?.();await click(entry.trigger);}
      await until(()=>options(entry).length||dateAgent?.recognizes(panel(entry)));
      const found=options(entry);trace(entry,'观察',`读取 ${found.length} 个选项`);return found;
    }
    function unique(pool,wanted,entry){
      if(entry?.meta?.datePart||root.ResumeProAIHelpers.selectEnumTopic(entry?.meta))return pool.filter(n=>root.ResumeProAIHelpers.findSelectOptionIndex([optionText(n)],wanted,entry.meta)>=0);
      const exact=pool.filter(n=>norm(optionText(n))===norm(wanted));
      if(exact.length)return exact;
      if(entry?.structuralChoice)return [];
      return pool.filter(n=>root.ResumeProAIHelpers.findSelectOptionIndex([optionText(n)],wanted)>=0);
    }
    function scroll(entry){
      const p=panel(entry);if(!p)return false;
      const scroller=[p,...p.querySelectorAll('*')].find(n=>visible(n)&&n.clientHeight>20&&n.scrollHeight>n.clientHeight+4&&n.scrollTop+n.clientHeight<n.scrollHeight-2);
      if(!scroller)return false;
      scroller.scrollTop+=Math.max(30,scroller.clientHeight-10);scroller.dispatchEvent(new Event('scroll',{bubbles:true}));trace(entry,'滚动');return true;
    }
    function searchInput(entry){
      const selector='input:not([readonly]):not([disabled]):not(.phoenix-select__input--unText)';
      const local=entry.root.matches(selector)?entry.root:entry.root.querySelector(selector);
      if(local&&visible(local))return local;
      // Phoenix places the editable search in the owning portal, not in its non-search trigger.
      const remote=Array.from(panel(entry)?.querySelectorAll(`${selector}[type="search"], .phoenix-search input, .phoenix-input__input:not([readonly]):not([disabled])`)||[]).filter(visible);
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
      if(delegated)await delegated;else {input.focus();setter.call(input,query);input.dispatchEvent(new Event('input',{bubbles:true}));}
      trace(entry,'搜索',query!==String(wanted)?`${wanted} → ${query}`:'');entry.remoteOptions=true;
      await until(()=>unique(options(entry),wanted,entry).length>0,2200);return true;
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
      },1800);
      if(!success)return false;
      if(!await close(entry))return false;
      localInput(entry)?.blur();
      await wait(180);
      const shown=read(entry);
      return norm(shown)===norm(selectedText)||norm(shown)===norm(value);
    }
    async function fillRules(entry,value){
      entry.interactions=[];entry.verifiedChoice='';entry.fillIssue='';
      const strict=entry.meta?.datePart||root.ResumeProAIHelpers.selectEnumTopic(entry.meta);
      const start=Date.now();const parts=String(value).split(/[\/／]/).map(s=>s.trim()).filter(Boolean);
      const fail=async note=>{entry.fillNote=note;trace(entry,'停止',note);await close(entry);return result(entry,false);};
      if(!live(entry))return fail('控件已替换，无法唯一定位');
      if(read(entry))return fail('控件已有内容，未覆盖');
      const query=entry.structuralChoice?localInput(entry)?.value?.trim():'';
      const dateQuery=entry.meta?.datePart&&root.ResumeProAIHelpers.normalizeDatePart(query,entry.meta.datePart);
      if(query&&norm(query)!==norm(value)&&!dateQuery)return fail('输入框已有未确认的搜索文字，请先核对，未覆盖');
      await open(entry);
      // Incomplete numeric date queries left by an earlier attempt are not
      // existing selected values. Replace only the query with the grounded target.
      if(dateQuery&&dateQuery!==root.ResumeProAIHelpers.normalizeDatePart(value,entry.meta.datePart))await search(entry,value);
      for(let level=0;level<parts.length;level++){
        const wanted=parts[level];let searched=false,clicked=false;
        for(let step=0;step<14&&Date.now()-start<15000;step++){
          if(!live(entry))return fail('控件已替换，无法唯一定位');
          const pool=options(entry);if(pool.length)entry.observedOptions=pool.map(optionText).slice(0,60);
          const matches=unique(pool,wanted,entry);
          if(matches.length>1)return fail('存在多个同名选项，未猜测');
          if(matches.length===1){
            // Re-observe immediately before clicking: a remote search can replace every option node.
            const fresh=unique(options(entry),wanted,entry);if(fresh.length!==1)continue;
            const selectedText=optionText(fresh[0]);
            trace(entry,'选择',`第 ${level+1} 级：${selectedText}`);clicked=true;
            if(level<parts.length-1){
              popup.transition(entry,states.SELECTING);
              await click(fresh[0]);
              await until(()=>unique(options(entry),parts[level+1],entry).length>0);
              popup.transition(entry,states.OPEN);
              break;
            }
            let success;
            try{success=await choose(entry,fresh[0],value);}
            catch(error){
              // The CDP channel rechecks hover changes before any mouse press. A replaced
              // node may be retried only after another unique, local observation.
              if(error.code==='input_target_missing'&&live(entry)&&unique(options(entry),wanted,entry).length===1){trace(entry,'重新观察','候选在点击前被替换');continue;}
              rememberError(entry,error);
              return fail(error.message);
            }
            if(success){
              entry.verifiedChoice=read(entry);entry.fillNote='';trace(entry,'核对','页面保留选中内容');return result(entry,true);
            }
            await fail('点击后未确认选中；搜索文字不算选择成功');return result(entry,false,'OPTION_COMMIT_UNCONFIRMED');
          }
          // Searching an unavailable level must not erase a populated finite
          // vocabulary and disguise its mismatch as a driver failure.
          if(strict&&pool.length){
            if(scroll(entry)){await wait(120);continue;}
            await wait(600);
            if(unique(options(entry),wanted,entry).length)continue;
            entry.fillIssue='choice-mismatch';
            return fail(`资料值“${wanted}”没有唯一等价选项，请人工确认；页面选项：${entry.observedOptions.join('、')}`);
          }
          if(!searched){searched=true;if(await search(entry,wanted))continue;}
          if(scroll(entry)){await wait(120);continue;}
          await until(()=>unique(options(entry),wanted,entry).length>0,600);
        }
        if(!clicked)return fail(panel(entry)?'未找到唯一匹配选项':'无法确认当前控件对应的下拉面板');
      }
      return fail('交互次数或等待时间达到上限');
    }
    async function fillControl(entry,value){
      if(!await ready(entry))return false;
      if(live(entry)&&phoenix(entry)&&!read(entry)){
        try{
          await open(entry);
          if(dateAgent?.recognizes(panel(entry))){
            const ok=await dateAgent.fill(entry,value),closed=await close(entry);
            if(!closed)entry.fillNote='日历仍未关闭，已暂停后续填写';
            return ok&&closed;
          }
        }catch(error){rememberError(entry,error);entry.fillNote=error.message;await close(entry);return false;}
      }
      if(!entry.decide||entry.structuralChoice||entry.meta?.datePart||root.ResumeProAIHelpers.selectEnumTopic(entry.meta)){
        try{return await fillRules(entry,value);}
        catch(error){rememberError(entry,error);entry.fillNote=error.message;trace(entry,'停止',error.message);await close(entry);return false;}
      }
      entry.interactions=[];entry.verifiedChoice='';entry.fillIssue='';
      if(read(entry)){entry.fillNote='控件已有内容，未覆盖';return false;}
      const parts=String(value).split(/[\/／]/).map(x=>x.trim()).filter(Boolean);
      let level=0,searched=false,selected='',lastAction='尚未操作',revision=0;
      const observe=()=>{
        if(!live(entry))return {blocked:'控件无法唯一定位'};
        const p=panel(entry);if(p)adoptPanel(entry,p);
        const pool=p?options(entry):[],wanted=parts[level];
        const matches=unique(pool,wanted,entry);
        if(matches.length>1)return {blocked:'存在多个匹配选项，未猜测'};
        const candidates=[{id:'stop',kind:'stop',label:'停止并交给用户'}];
        if(!p)candidates.push({id:'open',kind:'open',label:'打开当前控件'});
        else {
          if(matches.length===1){const index=pool.indexOf(matches[0]);candidates.push({id:'option-'+index,kind:'choose',index,label:optionText(matches[0])});}
          else pool.slice(0,60).forEach((node,index)=>{const label=optionText(node);if(label&&!placeholder(label)&&pool.filter(n=>norm(optionText(n))===norm(label)).length===1)candidates.push({id:'option-'+index,kind:'choose',index,label});});
          const input=searchInput(entry);
          if(input&&!searched)candidates.push({id:'search',kind:'search',label:'搜索当前层级目标'});
          candidates.push({id:'wait',kind:'wait',label:'等待异步选项'},{id:'scroll',kind:'scroll',label:'滚动当前面板'});
        }
        const snapshot={field:entry.meta,record:entry.recordContext,target:value,level,levelTarget:wanted,current:read(entry),options:pool.map(optionText).slice(0,60),lastAction,candidates};
        return {...snapshot,fingerprint:JSON.stringify([revision,level,Boolean(p),snapshot.current,snapshot.options,candidates])};
      };
      try{
        const ok=await root.ResumeProInteractionAgent.run({observe,decide:entry.decide,trace:(a,d)=>trace(entry,a,d),
          execute:async action=>{
            revision++;lastAction=action.kind;
            if(action.kind==='open')await open(entry);
            if(action.kind==='search'){searched=true;await search(entry,parts[level]);}
            if(action.kind==='wait')await wait(600);
            if(action.kind==='scroll'){scroll(entry);await wait(200);}
            if(action.kind==='choose'){
              popup.transition(entry,states.SELECTING);
              const node=options(entry)[action.index];selected=optionText(node);await click(node);
              if(level<parts.length-1){level++;searched=false;selected='';await wait(250);popup.transition(entry,states.OPEN);}
              else popup.transition(entry,states.VERIFYING);
            }
          },
          verify:async()=>{
            if(!selected)return false;
            const success=await until(()=>norm(read(entry))===norm(value)||norm(read(entry))===norm(selected),1800);
            if(!success){lastAction='点击未保留选中结果';selected='';return false;}
            if(!await close(entry))return false;await wait(180);
            if(norm(read(entry))!==norm(value)&&norm(read(entry))!==norm(selected)){selected='';return false;}
            entry.verifiedChoice=read(entry);trace(entry,'核对','页面保留选中内容');return true;
          }});
        entry.fillNote=ok?'':`AI 未确认结果；当前选项：${options(entry).map(optionText).slice(0,12).join('、')||'未读到'}`;return ok;
      }catch(error){rememberError(entry,error);entry.fillNote=error.message;trace(entry,'停止',error.message);return false;}
      finally{await close(entry);}
    }
    async function fill(entry,value){
      entry.interactionResult=null;entry.recoveryEvidence={};entry.failureCode='';
      const ok=await fillControl(entry,value);
      return result(entry,ok,entry.interactionResult?.code||'');
    }
    const dateAgent=root.ResumeProPhoenixDateAgent?.create({visible,panel,read,click,close,trace,until,readPeer:entry=>entry.rangePeer?config.readPeer?.(entry.rangePeer):undefined});
    return {read,panel,options,observe,open,close,fill,ready,prepare,pending,observation:popup.snapshot,blocking:()=>activeEntry,suspend:()=>{if(activeEntry)popup.pause(activeEntry);}};
  }
  root.ResumeProComboAgent={create};
})(typeof self!=='undefined'?self:globalThis);
