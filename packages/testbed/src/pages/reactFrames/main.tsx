import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';

const CHILD_URL = 'http://127.0.0.1:5173/react-frames-child.html';
const SRCDOC = '<!doctype html><html><body><form><label>备注<input name="note" /></label></form></body></html>';

function FramesPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');

  return (
    <div style={{ maxWidth: 720, lineHeight: 2 }}>
      <h1>跨域 iframe 组合表单</h1>
      <form id="frames-parent-form">
        <div>
          <label htmlFor="name">姓名</label>
          <input id="name" name="name" value={name} onChange={(event) => setName(event.target.value)} data-testid="name" />
        </div>
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
      <h2>跨域子框架（127.0.0.1）</h2>
      <iframe id="child-frame" src={CHILD_URL} title="child" style={{ width: 640, height: 220, border: '1px solid #ccc' }} />
      <h2>不可注入子框架（srcdoc）</h2>
      <iframe id="srcdoc-frame" srcDoc={SRCDOC} title="srcdoc" style={{ width: 640, height: 120, border: '1px solid #ccc' }} />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <FramesPage />
  </React.StrictMode>,
);
