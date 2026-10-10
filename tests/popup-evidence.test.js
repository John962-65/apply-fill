const {test}=require('node:test'),assert=require('node:assert/strict');
const {sanitizeFailures}=require('../popup-controller');
test('interaction evidence preserves only known statuses, codes and structural facts',()=>{
 const safe=sanitizeFailures([{fieldId:'field-4-4',status:'BLOCKED',code:'POPUP_CLOSE_UNCONFIRMED',expectedValue:'private name',url:'private url',
  observation:{state:'BLOCKED',reason:'https://private.invalid/?token=secret',ownership:'semantic',popupCandidates:2,popupOwned:true,ariaExpanded:true,targetText:'private option',
    transitions:['OPEN>RECOVERING','private>secret']},recovery:{escapeAttempted:true,blurAttempted:true,error:'secret'}},
  {status:'BLOCKED',code:'secret-token',fieldId:'private'}]);
 assert.deepEqual(safe,[{fieldId:'field-4-4',status:'BLOCKED',code:'POPUP_CLOSE_UNCONFIRMED',observation:{state:'BLOCKED',ownership:'semantic',popupCandidates:2,popupOwned:true,ariaExpanded:true,transitions:['OPEN>RECOVERING']},recovery:{escapeAttempted:true,blurAttempted:true}}]);
});
