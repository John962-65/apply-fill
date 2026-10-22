import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ReactDOM from 'react-dom/client';

const mode = new URLSearchParams(location.search).get('mode') ?? 'normal';
const month = mode === 'month';
const choices = month ? ['1', '10', '11', '12'] : ['男', '女'];

function Choice({ label = '性别', name = 'gender', value, onChange, available }: {
  label?: string; name?: string; value: string; onChange: (value: string) => void; available?: string[];
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [display, setDisplay] = useState('');
  const [clicks, setClicks] = useState(0);
  const [pointerEvents, setPointerEvents] = useState<string[]>([]);
  const [ready, setReady] = useState(!['takeover', 'repaint-user', 'empty-protected'].includes(mode));
  const ref = useRef<HTMLDivElement>(null);
  const items = available ?? (name.includes('major') ? ['计算机科学与技术', '软件工程'] : choices);
  const ignore = mode === 'ignore-click' || mode === 'search-only';
  const openPopup = () => { setOpen(true); if (!ready) setTimeout(() => setReady(true), 700); };
  const pointer = (event: React.PointerEvent, select?: string) => {
    setPointerEvents((current) => [...current, `${event.nativeEvent.constructor.name}:${event.pointerType}:${event.isTrusted}`]);
    if (mode === 'pointer-only' && event.nativeEvent instanceof PointerEvent && event.pointerType === 'mouse') {
      if (select) { onChange(select); setOpen(false); } else openPopup();
    }
  };
  const choose = (item: string, trusted: boolean) => {
    setClicks((current) => current + 1);
    if (ignore || mode === 'pointer-only' || mode === 'trusted-only' && !trusted) return;
    if (mode !== 'close-no-commit') { setQuery(item); setDisplay(item); }
    if (mode !== 'display-only' && mode !== 'close-no-commit') onChange(item);
    setOpen(false);
  };
  const rect = ref.current?.getBoundingClientRect();
  return <div data-combobox-root><label htmlFor={name}>{label}</label>
    <div ref={ref}><input required id={name} name={name} role="combobox" aria-controls={`${name}-popup`} aria-expanded={open}
      data-options={items.join(',')}
      value={query || display || value} data-committed={display || value} data-testid={name}
      onChange={(event) => setQuery(event.target.value)} onPointerDown={(event) => pointer(event)}
      onClick={() => { if (mode !== 'pointer-only') openPopup(); }} /></div>
    <input type="hidden" value={value} readOnly data-testid={`${name}-business`} />
    <output data-testid={`${name}-clicks`}>{clicks}</output>
    <output data-testid={`${name}-pointers`}>{pointerEvents.join('|')}</output>
    {open ? createPortal(<div id={`${name}-popup`} role="listbox" data-testid={`${name}-popup`}
      style={{ position: 'fixed', left: rect?.left ?? 10, top: rect?.bottom ?? 20, zIndex: 20, background: 'white', border: '1px solid #777', padding: 10 }}>
      <input type="search" aria-label="搜索候选" value={query} onChange={(event) => setQuery(event.target.value)} data-testid={`${name}-search`} />
      {(ready ? items : []).filter((item) => !query || item.includes(query)).map((item) => <div role="option" key={item} data-value={item}
        onPointerDown={(event) => pointer(event, item)} onClick={(event) => choose(item, event.isTrusted)}
        style={{ padding: 8 }} data-testid={`${name}-option-${item}`}>{item}</div>)}
    </div>, document.body) : null}
  </div>;
}

function SelectPage() {
  const [value, setValue] = useState(mode === 'close-no-commit' ? '女' : '');
  const [name, setName] = useState(mode === 'empty-protected' ? '先前填写' : '');
  const [reset, setReset] = useState(false);
  const [degree, setDegree] = useState('');
  return <main><h1>组件提交验证</h1><form>
    {mode === 'option-change' ? <label>最高学历<select value={degree} onChange={(event) => setDegree(event.target.value)} data-testid="highest">
      <option value="">请选择</option><option value="本科">本科</option><option value="硕士">硕士</option></select></label> : null}
    <Choice name={month ? 'birth-month' : 'gender'} label={month ? '出生日期（月）' : '性别'} value={value} onChange={(selected) => {
      setValue(selected); if (mode === 'reset-loop') setName('');
    }} available={mode === 'option-change' && !degree ? ['女'] : undefined} />
    <label>姓名<input required name="fullName" data-testid="name" value={name} onChange={(event) => {
      setName(event.target.value);
      if (mode === 'value-reset' && !reset) { setReset(true); setValue(''); }
      if (mode === 'reset-loop') setValue('');
    }} /></label>
    {mode !== 'empty-protected' ? <label>民族<input required data-testid="unmapped" /></label> : null}
    <output data-testid="reset">{String(reset)}</output>
  </form></main>;
}

type Entry = { id: string; school: string; degree: string; major: string };
function RepaintPage() {
  const [entries, setEntries] = useState<Entry[]>(['a', 'b'].map((id) => ({ id, school: '', degree: '', major: '' })));
  const [generation, setGeneration] = useState(0);
  const repainted = useRef(false);
  const [name, setName] = useState('');
  const change = (id: string, field: keyof Entry, value: string) => {
    setEntries((current) => current.map((entry) => entry.id === id ? { ...entry, [field]: value } : entry));
    if (field === 'degree' && !repainted.current) {
      repainted.current = true;
      setEntries((current) => [...current].reverse());
      setGeneration((current) => current + 1);
    }
    if (field === 'school' && value === '用户自填学校') setGeneration((current) => current + 1);
  };
  return <main><h1>整段重绘与经历绑定</h1><output data-testid="generation">{generation}</output>
    <form key={generation} name="application"><label>姓名<input name="fullName" value={name} onChange={(event) => setName(event.target.value)} data-testid="name" /></label>
      <section><h2>教育经历</h2>{entries.map((entry) => <fieldset key={entry.id} data-testid={`education-${entry.id}`}>
        <label>学校名称<input name={`school-${entry.id}`} data-field-id={`school-${entry.id}`} value={entry.school}
          data-testid={`school-${entry.id}`} onChange={(event) => change(entry.id, 'school', event.target.value)} /></label>
        <label>学历<select name={`degree-${entry.id}`} data-field-id={`degree-${entry.id}`} value={entry.degree}
          data-testid={`degree-${entry.id}`} onChange={(event) => change(entry.id, 'degree', event.target.value)}>
          {['', '本科', '硕士'].map((value) => <option key={value} value={value}>{value || '请选择'}</option>)}</select></label>
        <Choice name={`major-${entry.id}`} label="专业" value={entry.major} onChange={(value) => change(entry.id, 'major', value)} />
      </fieldset>)}</section>
    </form><pre data-testid="entries">{JSON.stringify(entries)}</pre>
  </main>;
}
ReactDOM.createRoot(document.getElementById('root')!).render(mode.startsWith('repaint') ? <RepaintPage /> : <SelectPage />);
