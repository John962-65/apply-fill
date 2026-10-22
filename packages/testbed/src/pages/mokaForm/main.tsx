import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';

type Option = { value: string; label: string };
const options = (values: string[]): Option[] => values.map((value) => ({ value, label: value }));
const YEARS = options(['2018', '2022', '2024', '2027']);
const MONTHS = Array.from({ length: 12 }, (_, index) => ({ value: String(index + 1), label: `${String(index + 1).padStart(2, '0')}月` }));
const DEGREES = [{ value: '本科', label: '本科/Bachelor' }, { value: '硕士', label: '硕士/Master' }];
const SCHOOLS = options(['示例大学', '其他大学']);

function Select({ value = '', onChange, items, placeholder = '请选择 / Please select', testId }: {
  value?: string; onChange: (value: string) => void; items: Option[]; placeholder?: string; testId: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [anchor, setAnchor] = useState({ left: 0, top: 0 });
  return <div className="sd-Dropdown-container-fixture"><label className="sd-Input-container-fixture sd-Select-container-fixture" style={{ display: 'block', border: '1px solid #ccc', padding: 4 }}
    onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); setAnchor({ left: rect.left, top: rect.bottom }); setOpen(true); }}>
    <span className="sd-Input-display-value-fixture" data-testid={`${testId}-selected`}>{items.find((item) => item.value === value)?.label ?? ''}</span>
    <input type="text" maxLength={-1} placeholder={placeholder} value={query} onChange={(event) => setQuery(event.target.value)} data-testid={testId} />
  </label><span>{open ? <div className="sd-Dropdown-dropdown-fixture" style={{ position: 'fixed', ...anchor, background: 'white', border: '1px solid #aaa', zIndex: 500, maxHeight: 420, overflow: 'auto' }}>
    <div className="sd-Select-menu-fixture">{items.map((item) => <div className="sd-Select-common-item-fixture" key={item.value} style={{ padding: 4 }}
      onClick={() => { onChange(item.value); setQuery(''); setOpen(false); }}><div className="sd-Menu-container-fixture"><div className="option-label-fixture">{item.label}</div></div></div>)}</div>
  </div> : null}</span></div>;
}

function Field({ title, required = false, children }: { title: string; required?: boolean; children: React.ReactNode }) {
  return <div className="apply-field-fixture" style={{ display: 'inline-block', width: 360, margin: 8, verticalAlign: 'top' }}>
    <div className="title-fixture"><span>{title}</span>{required ? <span className="required-asterisk-fixture">*</span> : null}</div>
    <div className="ctrl-fixture">{children}</div></div>;
}

function Block({ title, children, onAdd }: { title: string; children: React.ReactNode; onAdd?: () => void }) {
  return <div className="apply-block-fixture" style={{ borderTop: '1px solid #ccc', padding: 8 }}><div className="blockTitle-fixture"><div><span className="text-fixture">{title}</span>
    {onAdd ? <button type="button" onClick={onAdd}>添加 / Add</button> : null}</div></div>{children}</div>;
}

function MokaForm() {
  const [basic, setBasic] = useState<Record<string, string>>({ referral: 'SITE-REF' });
  const [education, setEducation] = useState<Array<Record<string, string>>>([{}]);
  const [projects, setProjects] = useState<Array<Record<string, string>>>([{}]);
  const [submissions, setSubmissions] = useState(0);
  const changeBasic = (key: string, value: string) => setBasic((current) => ({ ...current, [key]: value }));
  const changeEntry = (type: 'education' | 'projects', index: number, key: string, value: string) => (type === 'education' ? setEducation : setProjects)((current) => current.map((entry, position) => position === index ? { ...entry, [key]: value } : entry));
  const text = (key: string, values: Record<string, string>, change: (key: string, value: string) => void, placeholder: string) => <div className="sd-Tooltip-container-fixture"><label className="sd-Input-container-fixture">
    <input maxLength={-1} placeholder={placeholder} value={values[key] ?? ''} onChange={(event) => change(key, event.target.value)} data-testid={key} /></label></div>;
  const range = (prefix: string, values: Record<string, string>, change: (key: string, value: string) => void) => <div className="month-range-select date_info wrapper-fixture"><label className="label-fixture"></label>
    <span>{['startYear', 'startMonth'].map((key, index) => <div className="item-fixture" key={key}><Select value={values[key]} onChange={(value) => change(key, value)} items={index === 0 ? YEARS : MONTHS} placeholder={index === 0 ? '年 / Year' : '月 / Month'} testId={`${prefix}-${key}`} /></div>)}</span><span>-</span>
    <span>{['endYear', 'endMonth'].map((key, index) => <div className="item-fixture" key={key}><Select value={values[key]} onChange={(value) => change(key, value)} items={index === 0 ? YEARS : MONTHS} placeholder={index === 0 ? '年 / Year' : '月 / Month'} testId={`${prefix}-${key}`} /></div>)}</span></div>;
  const optional = (titles: string[]) => titles.map((title) => <Field key={title} title={title}><input placeholder="请输入 / Enter" /></Field>);
  return <><div className="navbar-fixture"><form><input placeholder="输入职位关键字" data-testid="job-search" /></form></div>
    <main className="apply-form-fixture"><h1>本地双语招聘表单</h1>
      <Block title="申请信息 / Applications"><div className="apply-fields-fixture"><Field title="意向工作城市 / Preferred work city" required><Select onChange={() => undefined} items={options(['上海'])} testId="preferred-city" /></Field>
        <Field title="推荐码 / Referral code">{text('referral', basic, changeBasic, '推荐码 / Referral code')}</Field></div></Block>
      <Block title="个人信息 / Personal info"><div className="apply-fields-fixture">
        <Field title="姓名 / Name" required>{text('name', basic, changeBasic, '姓名 / Name')}</Field>
        <Field title="姓名（中文） / Name( English)" required>{text('englishName', basic, changeBasic, '姓名（中文） / Name( English)')}</Field>
        <Field title="性别 / Gender" required><Select value={basic.gender} onChange={(value) => changeBasic('gender', value)} items={[{ value: '男', label: '男/Male' }, { value: '女', label: '女/Female' }]} testId="gender" /></Field>
        {(['年', '月', '日'] as const).map((part) => <Field title={`出生日期（${part}） / Date of Birth(${part === '年' ? 'Year' : part === '月' ? 'Month' : 'Date'})`} required key={part}>{text(`birth-${part}`, basic, changeBasic, `出生日期（${part}）`)}</Field>)}
        <Field title="最高学历 / Highest degree" required><Select value={basic.highest} onChange={(value) => changeBasic('highest', value)} items={DEGREES} testId="highest" /></Field>
        <Field title="民族 / Ethnicity" required><Select onChange={() => undefined} items={options(['汉族'])} testId="ethnicity" /></Field>
        <Field title="手机号码 / Mobile" required><div className="wrapper-fixture"><div className="code-fixture"><Select value="+86" onChange={() => undefined} items={options(['+86'])} placeholder="" testId="phone-code" /></div>
          {text('phone', basic, changeBasic, '请输入手机号 / Enter mobile number')}</div></Field>
        <Field title="邮箱 / Email" required>{text('email', basic, changeBasic, '邮箱 / Email')}</Field>
      </div></Block>
      <Block title="教育背景 / Education" onAdd={() => setEducation((current) => [...current, {}])}>{education.map((entry, index) => {
        const change = (key: string, value: string) => changeEntry('education', index, key, value);
        return <div className="apply-fields-fixture multi-fixture" key={index} data-testid={`education-${index}`}>
          <Field title="学校名称 / School" required><Select value={entry.school} onChange={(value) => change('school', value)} items={SCHOOLS} placeholder="请输入就读学校 / Enter school" testId={`ed-${index}-school`} /></Field>
          <Field title="就读时间 / Education period" required>{range(`ed-${index}`, entry, change)}</Field>
          <Field title="学历 / Degree" required><Select value={entry.degree} onChange={(value) => change('degree', value)} items={DEGREES} testId={`ed-${index}-degree`} /></Field>
          <Field title="专业名称 / Major" required>{text(`major-${index}`, entry, change, '请输入专业名称 / Enter major')}</Field>
        </div>;
      })}</Block>
      <Block title="校园经历 / Campus Experience"><div className="apply-fields-fixture">{optional(['项目名称 / Project name', '职位 / Position'])}</div></Block>
      <Block title="实习经历 / Internship experience"><div className="apply-fields-fixture"><Field title="起止时间 / Period">{range('work', {}, () => undefined)}</Field>{optional(['公司名称 / Company', '职位名称 / Job title', '工作职责 / Responsibilities'])}</div></Block>
      <Block title="项目经验 / Projects" onAdd={() => setProjects((current) => [...current, {}])}>{projects.map((entry, index) => {
        const change = (key: string, value: string) => changeEntry('projects', index, key, value);
        return <div className="apply-fields-fixture multi-fixture" key={index} data-testid={`project-${index}`}>
          <Field title="起止时间 / Period">{range(`project-${index}`, entry, change)}</Field>
          <Field title="项目名称 / Project name">{text(`project-name-${index}`, entry, change, '项目名称 / Project name')}</Field>
          <Field title="职责 / Organizational role">{text(`project-role-${index}`, entry, change, '职责 / Organizational role')}</Field>
          <Field title="项目描述 / Project description"><textarea placeholder="内容 / Content" data-testid={`project-desc-${index}`} value={entry.description ?? ''} onChange={(event) => change('description', event.target.value)} /></Field>
        </div>;
      })}</Block>
      <Block title="获奖经历 / Awards"><div className="apply-fields-fixture">{optional(['获奖时间 / Award time', '奖项名称 / Award name'])}</div></Block>
      <Block title="语言能力 / Language proficiency"><div className="apply-fields-fixture">{optional(['语言类型 / Language', '掌握程度 / Proficiency', '听说 / Listening and speaking', '读写 / Reading and writing'])}</div></Block>
      <Block title="特别声明"><div className="apply-fields-fixture">{['声明 / Declaration', '授权 / Authorize'].map((title) => <Field title={title} required key={title}><label><input type="checkbox" />确认 / Confirm</label></Field>)}</div></Block>
      <button type="button" onClick={() => setSubmissions((count) => count + 1)} data-testid="submit">预览并提交</button>
    </main><div className="sd-Modal-modal-fixture" style={{ display: 'none' }}><input placeholder="请输入邮箱" data-testid="login-email" /></div>
    <output data-testid="submissions">{submissions}</output><pre data-testid="form-state">{JSON.stringify({ basic, education, projects })}</pre>
  </>;
}

ReactDOM.createRoot(document.getElementById('root')!).render(<MokaForm />);
