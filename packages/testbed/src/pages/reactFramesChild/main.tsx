import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';

function FramesChildPage() {
  const [school, setSchool] = useState('');
  const [major, setMajor] = useState('');

  return (
    <form id="frames-child-form" style={{ lineHeight: 2, padding: 8 }}>
      <h2 style={{ margin: 0 }}>子框架教育信息</h2>
      <div>
        <label htmlFor="school">学校名称</label>
        <input
          id="school"
          name="school"
          value={school}
          onChange={(event) => setSchool(event.target.value)}
          data-testid="school"
        />
      </div>
      <div>
        <label htmlFor="major">专业</label>
        <input id="major" name="major" value={major} onChange={(event) => setMajor(event.target.value)} data-testid="major" />
      </div>
    </form>
  );
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <FramesChildPage />
  </React.StrictMode>,
);
