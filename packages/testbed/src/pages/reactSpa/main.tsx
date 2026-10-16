import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';

function SpaPage() {
  const [step, setStep] = useState<number>(() => (window.location.hash === '#step2' ? 2 : 1));
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');

  useEffect(() => {
    const onHash = () => {
      setStep(window.location.hash === '#step2' ? 2 : 1);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    if (step !== 1 || name === '') {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      window.location.hash = '#step2';
    }, 150);
    return () => window.clearTimeout(timer);
  }, [step, name]);

  return (
    <div style={{ maxWidth: 560, lineHeight: 2 }}>
      <h1>SPA 多步骤表单</h1>
      <p data-testid="step-indicator">当前步骤：{step}</p>
      {step === 1 ? (
        <form id="spa-step1-form">
          <div>
            <label htmlFor="name">姓名</label>
            <input id="name" name="name" value={name} onChange={(event) => setName(event.target.value)} data-testid="name" />
          </div>
        </form>
      ) : (
        <form id="spa-step2-form">
          <div>
            <label htmlFor="email">邮箱</label>
            <input
              id="email"
              name="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              data-testid="email"
            />
          </div>
        </form>
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <SpaPage />
  </React.StrictMode>,
);
