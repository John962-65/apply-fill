/* Local, bounded DOM evidence for a user-selected control. No network or storage. */
(() => {
  'use strict';
  const SIDEBAR = 'resume-pro-sidebar';
  const catalog=self.ResumeProControlCatalog;
  const ROOT = [catalog?.selector('selectRoot'),catalog?.selector('dateRoot'),catalog?.selector('captureRoot'),'[class*="sd-Dropdown-container"],[class*="date-picker"],[class*="calendar-picker"],.ant-picker,[class*="date-editor"],.phoenix-select,[role="combobox"],[class*="select__cont"],[class*="select-selector"],[class*="select-selection"]'].filter(Boolean).join(',');
  const PANEL = [catalog?.selector('selectPanel'),catalog?.selector('datePanel'),'[role="listbox"],[role="dialog"],[class*="calendar"],[class*="picker-panel"],[class*="picker-dropdown"],[class*="dropdown"],[class*="popover"]'].filter(Boolean).join(',');
  const OMIT = 'script,style,link,iframe,object,embed,svg,canvas';
  const ATTRS = ['class','role','type','placeholder','aria-expanded','aria-hidden','aria-disabled','aria-haspopup','aria-selected','tabindex','readonly','disabled','contenteditable'];
  const visible = n => {const r=n.getBoundingClientRect(),s=getComputedStyle(n);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'&&s.opacity!=='0';};
  function create({onUpdate=()=>{},getInteractionFailures=()=>[]}={}) {
    let data, active=false, auto=false, root=null, target=null, baseline=new Set(), discovered=new Set(), observer=null, deadline=null, debounce=null;
    let timers=new Set(), ids=new WeakMap(), nextId=0, count=0;
    const id=n=>{if(!n)return null;if(!ids.has(n))ids.set(n,'n'+(++nextId));return ids.get(n);};
    const ignored=n=>!n||n.nodeType!==1||n.closest('#'+SIDEBAR);
    const panels=()=>[...new Set(Array.from(document.querySelectorAll(PANEL)).filter(n=>catalog?.isPopup(n)!==false).map(n=>catalog?.popupRoot(n)||n))].filter(n=>!ignored(n)&&visible(n)&&!n.matches('body,html')).filter((n,i,a)=>!a.some(p=>p!==n&&p.contains(n)));
    const notify=message=>onUpdate({active,selected:Boolean(root),count:data?.snapshots.length||0,message});
    function describe(n) {
      const r=n.getBoundingClientRect(),s=getComputedStyle(n);
      const attrs={};for(const key of ATTRS){if(n.hasAttribute(key))attrs[key]=n.getAttribute(key).slice(0,180);}
      if(!n.matches('input,textarea,select,[contenteditable]:not([contenteditable="false"])')){
        for(const key of ['aria-label','title'])if(n.hasAttribute(key))attrs[key]=n.getAttribute(key)
          .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g,'[email]').replace(/\b1[3-9]\d{9}\b/g,'[phone]').slice(0,120);
        const date=n.getAttribute('data-date');
        if(date&&/^\d{4}(?:[-/.]\d{1,2}){0,2}$/.test(date))attrs['data-date']=date;
      }
      // Preserve relationships without copying opaque IDs, URLs or arbitrary data attributes.
      for(const key of ['aria-controls','aria-owns','aria-labelledby'])if(n.hasAttribute(key))attrs[key]=n.getAttribute(key).split(/\s+/).map(v=>id(document.getElementById(v))).filter(Boolean);
      const hit=r.width&&r.height?document.elementFromPoint(Math.max(0,Math.min(innerWidth-1,r.x+r.width/2)),Math.max(0,Math.min(innerHeight-1,r.y+r.height/2))):null;
      const info={node:id(n),tag:n.tagName.toLowerCase(),attrs,rect:{x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)},style:{display:s.display,visibility:s.visibility,opacity:s.opacity,pointerEvents:s.pointerEvents,position:s.position},connected:n.isConnected,visible:visible(n),hit:id(hit),hitWithin:Boolean(hit&&(n===hit||n.contains(hit)))};
      if(n.matches('input,textarea,select,[contenteditable]:not([contenteditable="false"])')) {
        info.hasValue=Boolean(n.value||n.isContentEditable&&n.textContent.trim());info.value='[removed]';info.text='[removed]';
      } else {
        const text=Array.from(n.childNodes).filter(c=>c.nodeType===3).map(c=>c.textContent).join(' ').replace(/\s+/g,' ').trim();
        if(text)info.text=text.replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g,'[email]').replace(/\b1[3-9]\d{9}\b/g,'[phone]').slice(0,120);
      }
      return info;
    }
    function tree(n,depth=0) {
      if(count++>=600)return {truncated:'node limit'};
      const out=describe(n);
      if(n.matches(OMIT)||n.matches('textarea,[contenteditable]:not([contenteditable="false"])'))return out;
      if(depth>=12){if(n.children.length)out.truncated='depth limit';return out;}
      out.children=[];
      for(const c of n.children){if(count>=600){out.truncated='node limit';break;}if(!ignored(c)&&!c.matches(OMIT))out.children.push(tree(c,depth+1));}
      return out;
    }
    function capture(reason='手动采集',meta) {
      if(!root)return notify('先在网页上点击一个日期框或下拉框。');
      if(data.snapshots.length>=24){stop('已达到 24 次快照上限，可以导出。');return;}
      count=0;
      const linked=new Set([root,target].filter(Boolean).flatMap(n=>['aria-controls','aria-owns'].flatMap(k=>(n.getAttribute(k)||'').split(/\s+/).map(v=>document.getElementById(v)).filter(Boolean))));
      // discovered 不能绕过 baseline：采集前就开着的浮层即使之后属性有变化也不属于这个控件，
      // 否则上一个控件没关掉的面板会混进后面每一个快照，导出文件里分不清归属。
      const candidates=[...new Set([...panels().filter(n=>!baseline.has(n)||linked.has(n)),...[...discovered].filter(n=>!baseline.has(n))])].filter(n=>n.isConnected&&visible(n)&&!ignored(n)&&!root.contains(n)&&!n.contains(root)&&!n.matches('body,html,form,main'));
      const popups=candidates.filter(n=>!candidates.some(p=>p!==n&&p.contains(n))).slice(0,4);
      const ancestors=[];for(let n=root.parentElement,i=0;n&&i<4&&n!==document.body;n=n.parentElement,i++)ancestors.push(describe(n));
      const snapshot={reason,elapsedMs:Date.now()-data.startedAt,target:id(target),root:tree(root),ancestors,panels:[],focus:id(document.activeElement)};
      const field=catalog?.fieldRoot(target||root);
      if(field&&!field.contains(document.getElementById(SIDEBAR)))snapshot.fieldContext=tree(field);
      snapshot.panels=popups.map(n=>tree(n));
      const family=catalog?.identify(target||root);
      if(family)snapshot.controlContract={...family,catalogVersion:catalog.version};
      if(meta)snapshot.auto={...meta};
      data.snapshots.push(snapshot);
      notify(root.isConnected?'已记录控件结构；可展开面板、切换年月，再点“完成并导出”。':'原控件已被页面替换；已记录断开状态，请导出。');
    }
    function schedule(reason) {
      clearTimeout(debounce);debounce=setTimeout(()=>{if(active)capture(reason);},250);
    }
    function selectRoot(n) {
      const picker=n.closest(ROOT);
      // Climb within the same widget, but never take the whole form.
      if(picker){let p=picker;for(let i=0;i<4;i++){const up=p.parentElement?.closest(ROOT);if(!up||up.matches('body,html,form'))break;p=up;}return p;}
      return n.closest('[class*="form-item"],[class*="form-field"]')||n.closest('input,select,textarea,button,[role="button"]');
    }
    // 自动点击采集：由程序指定控件，等价于用户的首次点击。discovered 必须按目标清空，
    // 否则上一个控件弹层的残留节点会被算进这一个控件的快照，导出文件里就分不清归属。
    function arm(node,meta) {
      if(!data||!node?.isConnected)return false;
      const chosen=selectRoot(node);
      if(!chosen||chosen.matches('body,html,form'))return false;
      target=node;root=chosen;baseline=new Set(panels());discovered=new Set();
      capture('自动点击前',meta);
      return true;
    }
    function setAuto(flag){auto=Boolean(flag);}
    function setAutoClick(summary){if(data)data.autoClick=summary;}
    function pointer(event) {
      // 自动点击由 driver 按目标节奏采集；CDP 的真点击也会冒泡到这里，不抑制就会重复且错位到下一个控件。
      if(auto)return;
      const n=event.composedPath().find(n=>n?.nodeType===1);
      if(ignored(n)||event.composedPath().some(n=>n?.id===SIDEBAR))return;
      if(!root){const chosen=selectRoot(n);if(!chosen||chosen.matches('body,html,form'))return notify('请直接点击日期框、下拉框或输入框，当前仍在等待选择。');target=n;root=chosen;baseline=new Set(panels());capture('点击前');}
      else capture('后续点击前');
      for(const delay of [350,1300,2600]){const t=setTimeout(()=>{timers.delete(t);if(active)capture('点击后 '+delay+'ms');},delay);timers.add(t);}
    }
    // 自动模式下 Escape 是「关弹层」的手段，不能当成「停止采集」。
    function key(event){if(!auto&&event.key==='Escape')stop('采集已停止，可以导出。');}
    function start({deadlineMs=60000}={}) {
      stop('',false);ids=new WeakMap();nextId=0;root=null;target=null;discovered=new Set();auto=false;
      data={kind:'apply-fill/control-dom',schemaVersion:1,pluginVersion:chrome.runtime.getManifest().version,host:location.hostname,startedAt:Date.now(),notice:'输入框值已移除；页面文字可能包含个人信息。无自动上传。',snapshots:[]};
      data.interactionFailures=self.ResumeProPopupController?.sanitizeFailures(getInteractionFailures())||[];
      active=true;document.addEventListener('pointerdown',pointer,true);document.addEventListener('keydown',key,true);
      observer=new MutationObserver(records=>{
        if(!root)return;
        // Unknown widgets must also be observable; do not depend solely on panel class names.
        for(const r of records)if(!ignored(r.target.nodeType===1?r.target:r.target.parentElement)){
          for(const n of r.addedNodes||[])if(n.nodeType===1&&!ignored(n)&&discovered.size<30)discovered.add(n);
          if(r.type==='attributes'&&r.target.nodeType===1&&visible(r.target)&&/absolute|fixed/.test(getComputedStyle(r.target).position)&&discovered.size<30)discovered.add(r.target);
        }
        // 自动采集按目标节奏出快照，弹层动画不能把 24 格配额吃掉；discovered 仍然照常收集。
        if(!auto&&records.some(r=>!ignored(r.target.nodeType===1?r.target:r.target.parentElement)))schedule('页面结构变化');
      });
      observer.observe(document.body,{subtree:true,childList:true,attributes:true,characterData:true});
      deadline=setTimeout(()=>stop(`已满 ${Math.round(deadlineMs/1000)} 秒，采集停止，可以导出。`),deadlineMs);
      notify('请点击网页中有问题的日期框或下拉框，再展开面板。'+Math.round(deadlineMs/1000)+' 秒后自动停止。');
    }
    function stop(message='采集已停止，可以导出。',update=true){active=false;auto=false;document.removeEventListener('pointerdown',pointer,true);document.removeEventListener('keydown',key,true);observer?.disconnect();observer=null;clearTimeout(deadline);clearTimeout(debounce);for(const t of timers)clearTimeout(t);timers.clear();if(update)notify(message);}
    function exportFile(){if(!data?.snapshots.length){notify('还没有采集到控件，请先开始采集并点击网页控件。');return false;}if(active)capture('导出前');stop();const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='applyfill-control-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return true;}
    function exportCurrent(targets=[]){
      start();auto=true;data.mode='current-page-read-only';data.totalTargets=targets.length;
      const seen=new Set();
      for(const item of catalog?.sampleTargets(targets,targets.length)||targets){
        const node=item.node,chosen=node?.isConnected&&selectRoot(node);
        if(!chosen||ignored(chosen)||seen.has(chosen))continue;
        if(data.snapshots.length>=24){data.truncated=true;break;}
        seen.add(chosen);
        target=node;root=chosen;baseline=new Set(panels());discovered=new Set();
        capture('当前结构（无点击、无输入）',{reason:item.reason||'page-scan',control:item.control||'',hint:item.hint||'',
          ...(item.labelSafe&&item.label?{label:item.label}: {})});
      }
      stop('当前网页结构已采集；未点击或修改网页控件。');
      const saved=exportFile();if(saved)notify('已导出当前网页结构；未点击或修改网页控件。');return saved;
    }
    return {start,stop,capture,arm,setAuto,setAutoClick,exportFile,exportCurrent,preview:()=>data?JSON.stringify(data,null,2):'',panels,get active(){return active;}};
  }
  self.ResumeProControlCapture={create,ROOT,PANEL};
})();
