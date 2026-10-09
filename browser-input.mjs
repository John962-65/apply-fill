// Narrow CDP transport; no page-provided commands, scripts, tab IDs or selectors are accepted.
const messages = Object.freeze({
 input_invalid: '操作参数无效', input_too_long: '输入内容过长',
 input_target_missing: '操作目标已被替换，未点击', input_target_ambiguous: '操作目标不唯一，未点击',
 input_target_disabled: '操作目标不可用，未点击', input_target_moving: '操作目标仍在移动，未点击',
 input_target_hidden: '操作目标不可见，未点击', input_target_covered: '操作目标被遮挡，未点击',
 input_observation: '无法核对浏览器操作目标，未点击', input_focus: '输入焦点不匹配，未输入',
 input_context: '仅支持当前顶层网页', input_busy: '该页面已有操作进行中',
 input_foreground: '请保持目标招聘页面在前台', input_attach: '无法连接浏览器输入通道，请关闭该页面的开发者工具后重试',
 input_page_changed: '招聘页面地址已变化，请重新扫描后填写',
 input_transport: '浏览器输入通道已中断，请稍后重试'
});
function inputError(code) {
 const safeCode = Object.hasOwn(messages, code) ? code : 'input_observation';
 const error = new Error(messages[safeCode]);
 error.code = safeCode;
 return error;
}
function readPoint(result) {
 const value = result?.result?.value;
 if (result?.exceptionDetails || !value?.ok) throw inputError(value?.errorCode || 'input_observation');
 if (!Number.isFinite(value.point?.x) || !Number.isFinite(value.point?.y)) throw inputError('input_observation');
 return value.point;
}
export async function performInput(send, action) {
 if (!action || typeof action !== 'object') throw inputError('input_invalid');
 if (!/^[a-f0-9-]{36}$/.test(action.token || '') || !['click', 'fill', 'key', 'dismiss'].includes(action.kind)) throw inputError('input_invalid');
 if (action.kind === 'key') {
  // Escape is the only key-only operation. It dismisses an owned popup without
  // clicking its covered trigger, choosing a focused suggestion, or submitting a form.
  if (action.key !== 'Escape') throw inputError('input_invalid');
  const focusOwned = () => {
   const fail = errorCode => ({ok:false,errorCode});
   const nodes=document.querySelectorAll('[data-applyfill-input="TOKEN"]');
   if(nodes.length!==1)return fail(nodes.length?'input_target_ambiguous':'input_target_missing');
   const el=nodes[0];
   if(el.matches('[disabled],[aria-disabled="true"]')||el.closest('[inert]'))return fail('input_target_disabled');
   if(!el.getClientRects().length||getComputedStyle(el).visibility==='hidden')return fail('input_target_hidden');
   const focus=el.matches('input:not([type="hidden"]),textarea,select,[tabindex]')?el:el.querySelector('input:not([type="hidden"]):not([disabled]),[tabindex]');
   focus?.focus({preventScroll:true});
   return document.activeElement===el||el.contains(document.activeElement)?{ok:true}:fail('input_focus');
  };
  const focused=await send('Runtime.evaluate',{expression:`(${focusOwned.toString().replace('TOKEN',action.token)})()`,returnByValue:true});
  if(focused.exceptionDetails||!focused.result?.value?.ok)throw inputError(focused.result?.value?.errorCode||'input_observation');
  const confirmed=await send('Runtime.evaluate',{expression:`(()=>{const nodes=document.querySelectorAll('[data-applyfill-input="${action.token}"]');return nodes.length===1&&nodes[0].isConnected&&(nodes[0]===document.activeElement||nodes[0].contains(document.activeElement));})()`,returnByValue:true});
  if(confirmed.exceptionDetails||confirmed.result?.value!==true)throw inputError('input_focus');
  for(const type of ['keyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  return {ok:true};
 }
 if (action.kind === 'fill' && (typeof action.text !== 'string' || action.text.length > 500)) throw inputError('input_too_long');
 const locate = async () => {
  const fail = errorCode => ({ok: false, errorCode});
  const nodes = document.querySelectorAll('[data-applyfill-input="TOKEN"]');
  if (!nodes.length) return fail('input_target_missing');
  if (nodes.length !== 1) return fail('input_target_ambiguous');
  const el = nodes[0];
  if (!el.isConnected) return fail('input_target_missing');
  if (el.matches('[disabled],[aria-disabled="true"]') || el.closest('[inert]')) return fail('input_target_disabled');
  if ('KIND' === 'dismiss') {
   if(el===document.body||el===document.documentElement)return fail('input_invalid');
   // A captured Formily label is an inert surface outside its own popup.
   // Dense resume layouts can cover every bare-body point. Never substitute
   // an arbitrary neighbor, button, linked label, or interactive descendant.
   const label=el.matches('.ud-formily-item-label')&&el.closest('.ud-formily-item')
    &&!el.matches('label[for],a,button,input,[role="button"]')
    &&!el.querySelector('input,textarea,select,button,a,label[for],[role="button"],[role="combobox"]');
   if(!label){
   // Click only bare page background. A descendant of body may be a submit button;
   // containment is deliberately insufficient for this outside-click operation.
   for(const fy of [.02,.98,.1,.9,.5])for(const fx of [.02,.98,.1,.9,.5]){
    const point={x:innerWidth*fx,y:innerHeight*fy},hit=document.elementFromPoint(point.x,point.y);
    if(hit===document.body||hit===document.documentElement)return {ok:true,point};
   }
   return fail('input_target_covered');
   }
  }
  el.scrollIntoView({block: 'center', inline: 'nearest', behavior: 'instant'});
  let previous = '', stable = 0;
  for (let i = 0; i < 12; i++) {
   await new Promise(resolve => setTimeout(resolve, 40));
   if (!el.isConnected) return fail('input_target_missing');
   const r = el.getBoundingClientRect(), position = [r.x, r.y, r.width, r.height].map(v => Math.round(v)).join(',');
   stable = position === previous ? stable + 1 : 0; previous = position;
   if (stable >= 2) break;
   if (i === 11) return fail('input_target_moving');
  }
  const r = el.getBoundingClientRect();
  const left = Math.max(r.left, 0), top = Math.max(r.top, 0), right = Math.min(r.right, innerWidth), bottom = Math.min(r.bottom, innerHeight);
  if (right <= left || bottom <= top || getComputedStyle(el).visibility === 'hidden') return fail('input_target_hidden');
  // A badge can cover the center while another part of the same target is free.
  // Every candidate still has to hit this exact target, never a nearby control.
  for (const [fx, fy] of [[.5,.5],[.2,.2],[.8,.2],[.2,.8],[.8,.8],[.5,.2],[.5,.8],[.2,.5],[.8,.5]]) {
   const x = left + (right - left) * fx, y = top + (bottom - top) * fy;
   const hit = document.elementFromPoint(x, y);
   if (hit && (el === hit || el.contains(hit))) return {ok: true, point: {x, y}};
  }
  return fail('input_target_covered');
 };
 const expression = `(${locate.toString().replace('TOKEN', action.token).replace('KIND', action.kind)})()`;
 const point = readPoint(await send('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true}));
 await send('Input.dispatchMouseEvent', {...point, type: 'mouseMoved', button: 'none', clickCount: 0});
 // Hover handlers can replace a control. Check again before pressing.
 const confirm = () => {
  const nodes = document.querySelectorAll('[data-applyfill-input="TOKEN"]');
  if (!nodes.length) return {ok: false, errorCode: 'input_target_missing'};
  if (nodes.length !== 1) return {ok: false, errorCode: 'input_target_ambiguous'};
  const el = nodes[0], point = POINT, r = el.getBoundingClientRect(), hit = document.elementFromPoint(point.x, point.y);
  if (el.matches('[disabled],[aria-disabled="true"]') || el.closest('[inert]')) return {ok: false, errorCode: 'input_target_disabled'};
  if('KIND'==='dismiss'){
   const label=el.matches('.ud-formily-item-label')&&el.closest('.ud-formily-item')
    &&!el.matches('label[for],a,button,input,[role="button"]')
    &&!el.querySelector('input,textarea,select,button,a,label[for],[role="button"],[role="combobox"]');
   if(!label)return hit===document.body||hit===document.documentElement?{ok:true,point}:{ok:false,errorCode:'input_target_covered'};
  }
  if (point.x < r.left || point.x >= r.right || point.y < r.top || point.y >= r.bottom) return {ok: false, errorCode: 'input_target_moving'};
  return hit && (el === hit || el.contains(hit)) ? {ok: true, point} : {ok: false, errorCode: 'input_target_covered'};
 };
 readPoint(await send('Runtime.evaluate', {expression: `(${confirm.toString().replace('TOKEN', action.token).replace('POINT', JSON.stringify(point)).replace('KIND',action.kind)})()`, returnByValue: true}));
 for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', {...point, type, button: 'left', clickCount: 1});
 if (action.kind === 'fill') {
  const focus = await send('Runtime.evaluate', {expression: `document.activeElement?.getAttribute('data-applyfill-input')===${JSON.stringify(action.token)} && !document.activeElement.readOnly && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)`, returnByValue: true});
  if (focus.result?.value !== true) throw inputError('input_focus');
  await send('Input.dispatchKeyEvent', {type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 2, commands: ['selectAll']});
  await send('Input.dispatchKeyEvent', {type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2});
  await send('Input.insertText', {text: action.text});
  if (action.enter) for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', {type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13});
 }
 return {ok: true};
}
export function installBrowserInput(chrome) {
 const busy = new Set();
 const failure = code => ({ok: false, errorCode: code, error: messages[code]});
 chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.type !== 'BROWSER_INPUT') return false;
  const tabId = sender.tab?.id;
  if (sender.id !== chrome.runtime.id || !Number.isInteger(tabId) || sender.frameId !== 0 || !/^https?:/.test(sender.url || '')) { reply(failure('input_context')); return false; }
  if (busy.has(tabId)) { reply(failure('input_busy')); return false; }
  busy.add(tabId);
  (async () => {
   let attached = false; const target = {tabId};
   try {
    const tab = await chrome.tabs.get(tabId);
    const pageURL = sender.url.split('#')[0];
    if (tab.url?.split('#')[0] !== pageURL || tab.pendingUrl && tab.pendingUrl.split('#')[0] !== pageURL) throw inputError('input_page_changed');
    try { await chrome.debugger.attach(target, '1.3'); } catch { throw inputError('input_attach'); }
    attached = true;
    // CDP addresses the sender's tab, including an inactive one. Never route
    // input to the active tab, or confuse a hash change with a lost foreground.
    const send = async (method, params) => {
     if (method.startsWith('Input.')) {
      const current = await chrome.debugger.sendCommand(target, 'Runtime.evaluate', {
       expression: `location.href.split('#')[0]===${JSON.stringify(pageURL)}`, returnByValue: true
      });
      if (current.exceptionDetails || current.result?.value !== true) throw inputError('input_page_changed');
     }
     return chrome.debugger.sendCommand(target, method, params);
    };
    return await performInput(send, message.action || {});
   } catch (error) { return failure(Object.hasOwn(messages, error.code) ? error.code : 'input_transport'); }
   finally { if (attached) await chrome.debugger.detach(target).catch(() => {}); busy.delete(tabId); }
  })().then(reply); return true;
 });
}
