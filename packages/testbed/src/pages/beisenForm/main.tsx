import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';

function Field({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="fields-col" style={{ display: 'inline-block', width: 400, padding: 8 }}><div className="form-item form-item--phoenix">
    <div className="form-item__title"><a className="form-item__required"><svg width="6" height="6"><title>必填</title></svg></a>
      <span><label className="form-item__text">{title}</label></span><i className="icon-cus-bangzhu" title="字段说明" /></div>
    <div className="form-item__control">{children}<span className="form-item__info">请核对后填写</span></div>
  </div></div>;
}

function Part({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="form-part"><div className="form-part-head"><span className="head-title">{title}</span></div><div>{children}</div></div>;
}

function BeisenFormPage() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [submissions, setSubmissions] = useState(0);
  const text = (key: string, placeholder = '请输入') => <div className="phoenix-text-field"><input data-testid={key} placeholder={placeholder}
    value={values[key] ?? ''} onChange={(event) => setValues((previous) => ({ ...previous, [key]: event.target.value }))} /></div>;
  return <form className="ux-standard-form" onSubmit={(event) => { event.preventDefault(); setSubmissions((count) => count + 1); }}>
    <h1>招聘投递表单</h1>
    <Part title="上传简历"><input type="file" /></Part>
    <Part title="个人信息">
      <Field title="姓名">{text('name')}</Field>
      <Field title="性别"><div className="phoenix-radio-group">
        {['男', '女'].map((gender) => <label key={gender}><input type="radio" value={gender} data-testid={`gender-${gender}`}
          checked={values.gender === gender} onChange={() => setValues((previous) => ({ ...previous, gender }))} />{gender}</label>)}
      </div></Field>
      <Field title="出生日期"><input data-testid="birth" placeholder="请选择" readOnly /></Field>
      <Field title="政治面貌"><input data-testid="politics" placeholder="请选择" readOnly /></Field>
      <Field title="民族"><input data-testid="ethnicity" placeholder="请选择" readOnly /></Field>
      <Field title="手机号码"><span>中国大陆</span>{text('phone', '请输入11位手机号')}</Field>
      <Field title="邮箱">{text('email')}</Field>
      <Field title="第一外语语种">{text('language-1', '填写示例：英语')}</Field>
      <Field title="第一外语语种等级或成绩">{text('language-level-1', '填写示例英语六级500')}</Field>
      <Field title="第二外语语种">{text('language-2', '填写示例：英语')}</Field>
      <Field title="第二外语语种等级或成绩">{text('language-level-2', '填写示例英语六级500')}</Field>
      <Field title="技能、兴趣、爱好与特长及等级"><textarea data-testid="skills" placeholder="请输入" /></Field>
      <div>{text('unknown-1')}{text('unknown-2')}</div>
    </Part>
    <Part title="教育经历">
      <Field title="学校名称">{text('school')}</Field>
      <Field title="专业">{text('major')}</Field>
      <Field title="学历"><select data-testid="degree" value={values.degree ?? ''} onChange={(event) => setValues((previous) => ({ ...previous, degree: event.target.value }))}>
        <option value="">请选择</option><option>本科</option><option>硕士</option></select></Field>
    </Part>
    <button type="submit">预览并提交</button><output data-testid="submissions">{submissions}</output>
  </form>;
}

ReactDOM.createRoot(document.getElementById('root')!).render(<BeisenFormPage />);
