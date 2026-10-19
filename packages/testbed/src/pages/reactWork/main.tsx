import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';

interface WorkItem {
  id: number;
  company: string;
  role: string;
  description: string;
  startDate: string;
  endDate: string;
}

const blank = (id: number): WorkItem => ({ id, company: '', role: '', description: '', startDate: '', endDate: '' });
const fields = { company: '公司名称', role: '职位', description: '工作描述', startDate: '开始时间', endDate: '结束时间' };

function WorkPage() {
  const [items, setItems] = useState([blank(1)]);
  const [version, setVersion] = useState(0);
  return (
    <form>
      <section>
        <h2>工作经历</h2>
        <div key={version}>
          {items.map((item) => <div key={item.id} data-testid="work-item">
            {(Object.entries(fields) as Array<[keyof typeof fields, string]>).map(([key, label]) => (
              <label key={key} style={{ display: 'block' }}>
                {label}
                <input name={key} type={key.endsWith('Date') ? 'month' : 'text'} value={item[key]}
                  onChange={(event) => setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, [key]: event.target.value } : entry))} />
              </label>
            ))}
          </div>)}
        </div>
        <button type="button" onClick={() => setItems((current) => [...current, blank(current.length + 1)])}>添加工作</button>
        <button type="button" data-testid="work-remount" onClick={() => setVersion((current) => current + 1)}>重绘经历</button>
        <button type="button" data-testid="work-reorder" onClick={() => setItems((current) => [...current].reverse())}>反转经历</button>
      </section>
    </form>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<WorkPage />);
