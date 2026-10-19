import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';

function SameSteps() {
  const params = new URLSearchParams(location.search);
  const mode = params.get('mode') ?? 'heading';
  const automatic = params.get('advance') !== 'manual';
  const [step, setStep] = useState(1);
  const [names, setNames] = useState<Record<number, string>>({ 1: '', 2: '' });
  const [email, setEmail] = useState('');
  const [extra, setExtra] = useState(false);
  const [revision, setRevision] = useState(0);
  const move = (next: number) => {
    if (mode === 'query') {
      const url = new URL(location.href); url.searchParams.set('step', String(next));
      history.pushState({}, '', url);
    }
    setStep(next);
  };
  useEffect(() => {
    if (!automatic || (mode !== 'loop' && step !== 1) || !names[step]) return;
    const timer = setTimeout(() => {
      if (mode === 'query') {
        const url = new URL(location.href); url.searchParams.set('step', '2'); history.pushState({}, '', url);
      }
      setStep(mode === 'loop' ? step + 1 : 2);
    }, 150);
    return () => clearTimeout(timer);
  }, [automatic, mode, step, names]);
  return <main style={{ maxWidth: 600, lineHeight: 2 }}>
    <h1>{mode === 'heading' ? (step === 1 ? '基本信息' : '补充信息') : '申请信息'}</h1>
    <nav>{[1, 2].map((value) => <span key={value} aria-current={mode === 'marker' && value === step ? 'step' : undefined}>步骤 {value} </span>)}</nav>
    <p data-testid="step-indicator">当前步骤：{step}</p>
    <form id="same-application" key={revision} data-current-step={mode === 'loop' ? step : undefined}>
      {mode === 'experience' ? <section data-step={step}>
        <h2>教育经历</h2>
        <div className="education-entry">
          <label htmlFor="school">学校名称</label>
          <input id="school" name="school" data-testid="same-school" value={names[step]} onChange={(event) => setNames((old) => ({ ...old, [step]: event.target.value }))} />
        </div>
      </section> : <>
      <label htmlFor="name">姓名</label>
      <input id="name" name="name" data-testid="same-name" value={names[step] ?? ''} onChange={(event) => setNames((old) => ({ ...old, [step]: event.target.value }))} />
      {extra ? <div><label htmlFor="email">邮箱</label><input id="email" name="email" data-testid="same-email" value={email} onChange={(event) => setEmail(event.target.value)} /></div> : null}
      </>}
      <button type="button" onClick={() => move(1)} data-testid="previous">上一步</button>
      <button type="button" onClick={() => move(2)} data-testid="next">下一步</button>
      <button type="button" onClick={() => setRevision((old) => old + 1)} data-testid="remount">重绘表单</button>
      <button type="button" onClick={() => setExtra(true)} data-testid="reveal">显示邮箱</button>
    </form>
  </main>;
}
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><SameSteps /></React.StrictMode>);
