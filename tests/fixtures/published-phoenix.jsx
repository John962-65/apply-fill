// Actual pinned vendor components. Fixture data is anonymous and never leaves this test.
import React from 'react';
import ReactDOM from 'react-dom';
import Select from '@beisen-phoenix/select/cjs';
import SelectList from '@beisen-phoenix/select-list/cjs';
import Layer from '@beisen-phoenix/unmodeled-layer/cjs';

window.values={};window.actions=[];
function Widget({id,label,options,initial=''}) {
  const [value,setValue]=React.useState(initial),[open,setOpen]=React.useState(false);
  return <div className="phoenix-form-item" data-test={id}>
    <div className="phoenix-form-item-label-content">{label}</div>
    <Layer trigger="click" visible={open} onVisibleChange={next=>setOpen(next)} destroyPopupOnHide={false}
      content={<SelectList options={options.map(o=>typeof o==='string'?{label:o,value:o}:o)}
        onSelect={({selectOption},event)=>{
          window.actions.push({id,kind:'choose',trusted:event.isTrusted});
          if(event.isTrusted){setValue(selectOption.label);window.values[id]=selectOption.label;setOpen(false);}
        }}/>}>
      <Select value={value} size="large" placeHolder="请选择" isActive={open}
        onClick={event=>window.actions.push({id,kind:'open',trusted:event.isTrusted})}/>
    </Layer>
  </div>;
}
function Deep({children}){for(let i=0;i<20;i++)children=<div>{children}</div>;return children;}
function App(){return <>
  <nav><span>在校职务</span><span>教育经历</span></nav>
  <section><div className="sc-anonymous"><span>教育经历</span></div>
    {['硕士','本科'].map((degree,i)=><article className="education-record" key={degree}>
      <div className="sc-school-field"><div className="sc-school-caption"><span>学校</span><span>名称</span></div>
        <div className="phoenix-unmodeled-layer__content"><div className="phoenix-input"><Deep><input id={'school-'+i} placeholder="请输入" className="phoenix-input__input phoenix-input__input--sizeLarge"/></Deep></div></div>
      </div>
      <Deep><Widget id={'degree-'+i} label="学历" options={['硕士研究生','大学本科',{label:'博士',value:'博士',disabled:true}]}/></Deep>
    </article>)}
  </section>
  <section><div className="sc-another"><span>在校职务</span></div>
    {[1,2].map(i=><article className="campus-record" key={i}>
      <label>职务名称<input id={'role-'+i}/></label>
      <div><label>职务描述<textarea id={'duties-'+i}/></label></div>
    </article>)}
  </section>
  <section><div className="sc-final"><span>语言能力</span></div>
    <Widget id="language" label="语言类型" options={['英语','日语']}/>
    <Widget id="proficiency" label="掌握程度" options={['良好','一般']}/>
    <Widget id="protected" label="其他语言" options={['英语','日语']} initial="日语"/>
    <Widget id="disabled" label="备用语种" options={[{label:'英语',value:'英语',disabled:true},'日语']}/>
    <Widget id="duplicate" label="同名语种" options={[{label:'英语',value:'a'},{label:'英语',value:'b'}]}/>
  </section>
  <input id="heading-value" value="在校职务" readOnly aria-label="测试已填内容"/>
  <label>语言能力<input id="label-is-not-heading" aria-label="测试字段"/></label>
  <input id="after-control" aria-label="姓名"/>
  <div className="parallel-fields"><div><div>相邻字段</div><input id="neighbor"/></div><div><Deep><input id="deep-unknown" placeholder="请输入"/></Deep></div></div>
</>;}
ReactDOM.render(<App/>,document.getElementById('app'));
