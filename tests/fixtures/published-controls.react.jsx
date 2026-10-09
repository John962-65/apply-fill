import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import Select from 'react-select';
import Picker from 'rc-picker';
import dayjs from 'dayjs';
import dayjsGenerateConfig from 'rc-picker/lib/generate/dayjs';
import zhCN from 'rc-picker/lib/locale/zh_CN';

function Controls(){
  const [values,setValues]=useState({});
  const set=(id,v)=>{window.values[id]=dayjs.isDayjs(v)?v.format('YYYY-MM-DD'):v?.value;setValues(prev=>({...prev,[id]:v}));};
  return <section><h2>项目经历</h2><article className="record">
    <div className="ant-form-item"><label>项目名称<input id="react-project"/></label></div>
    {['month','day','year'].map(type=><div key={type} className="ant-form-item" data-test={'ant-'+type}>
      <div className="ant-form-item-label">{type==='year'?'获奖时间':type==='day'?'出生日期':'开始时间'}</div>
      <Picker prefixCls="ant-picker" generateConfig={dayjsGenerateConfig} locale={zhCN} picker={type==='day'?'date':type}
        format={type==='day'?'YYYY-MM-DD':type==='year'?'YYYY':'YYYY-MM'} placeholder={type==='day'?'YYYY-MM-DD':type==='year'?'YYYY':'YYYY-MM'}
        value={values['ant-'+type]} onChange={v=>set('ant-'+type,v)}/>
    </div>)}
    <div className="ant-form-item" data-test="react-language"><div className="ant-form-item-label">语言</div>
      <Select inputId="react-language" value={values.language||null} onChange={v=>set('language',v)} placeholder="请选择"
        options={[{value:'英语',label:'英语'},{value:'法语',label:'法语'},{value:'日语',label:'日语',isDisabled:true}]}/></div>
    <div className="ant-form-item" data-test="react-protected"><div className="ant-form-item-label">学历</div>
      <Select inputId="react-protected" value={{value:'硕士',label:'硕士'}} placeholder="请选择"
        options={[{value:'本科',label:'本科'},{value:'硕士',label:'硕士'}]}/></div>
  </article></section>;
}
createRoot(document.getElementById('react-fixture')).render(<Controls/>);
window.reactReady=true;
