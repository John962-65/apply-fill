/* Shared, bounded page-state planner. All model actions refer to freshly observed capabilities. */
(function(root){
 function validate(action,candidates){
  if(!action||typeof action!=='object'||typeof action.id!=='string'||Object.keys(action).some(k=>k!=='id'))throw new Error('AI 操作格式无效');
  const matches=candidates.filter(c=>c.id===action.id);
  if(matches.length!==1)throw new Error('AI 选择了当前页面不存在的操作');
  return matches[0];
 }
 async function run({observe,decide,execute,verify,trace=()=>{},maxSteps=10}){
  for(let step=0;step<maxSteps;step++){
   const state=await observe(step);
   if(state.done)return true;
   if(state.blocked){trace('停止',state.blocked);return false;}
   const candidates=state.candidates||[];
   if(!candidates.length)return false;
   const action=validate(await decide({...state,step}),candidates);
   if(action.kind==='stop'){trace('停止','AI 无法确认下一步');return false;}
   // Reject stale decisions; never reuse DOM references across a model request.
   const fresh=await observe(step);
   if(fresh.done)return true;
   if(fresh.blocked)return false;
   if(fresh.fingerprint!==state.fingerprint){trace('重新观察','等待期间页面发生变化');continue;}
   const current=validate({id:action.id},fresh.candidates||[]);
   trace('AI 操作',current.label||current.kind);
   await execute(current);
   if(await verify())return true;
  }
  trace('停止','达到交互步数上限');return false;
 }
 root.ResumeProInteractionAgent={validate,run};
 if(typeof module!=='undefined')module.exports=root.ResumeProInteractionAgent;
})(typeof self!=='undefined'?self:globalThis);
