import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ReactDOM from 'react-dom/client';

const YEARS = ['2022', '2023', '2024', '2025', '2026', '2027', '2028'];
const MONTHS = Array.from({ length: 12 }, (_, index) => String(index + 1));

interface Anchor {
  left: number;
  top: number;
}

function BeisenMonthPage() {
  const [name, setName] = useState('');
  const [year, setYear] = useState('');
  const [yearOpen, setYearOpen] = useState(false);
  const [yearAnchor, setYearAnchor] = useState<Anchor>({ left: 0, top: 0 });
  const [month, setMonth] = useState('');
  const [monthOpen, setMonthOpen] = useState(false);
  const [monthQuery, setMonthQuery] = useState('');
  const [monthAnchor, setMonthAnchor] = useState<Anchor>({ left: 0, top: 0 });
  const [monthKey, setMonthKey] = useState(0);
  const yearTriggerRef = useRef<HTMLDivElement>(null);
  const monthTriggerRef = useRef<HTMLDivElement>(null);

  const toggleYear = () => {
    if (yearOpen) {
      setYearOpen(false);
      return;
    }
    const element = yearTriggerRef.current;
    if (element !== null) {
      const rect = element.getBoundingClientRect();
      setYearAnchor({ left: rect.left, top: rect.bottom + 4 });
    }
    setYearOpen(true);
  };

  const openMonth = () => {
    if (monthOpen) {
      setMonthOpen(false);
      return;
    }
    setMonthQuery('');
    const element = monthTriggerRef.current;
    if (element !== null) {
      const rect = element.getBoundingClientRect();
      setMonthAnchor({ left: rect.left, top: rect.bottom + 4 });
    }
    setMonthOpen(true);
  };

  const filteredMonths = MONTHS.filter((item) => item.includes(monthQuery));

  return (
    <form id="beisen-form" style={{ maxWidth: 640, lineHeight: 2 }}>
      <h1>北森式年月选择表单</h1>
      <div>
        <label htmlFor="name">姓名</label>
        <input id="name" name="name" value={name} onChange={(event) => setName(event.target.value)} data-testid="name" />
      </div>

      <div data-combobox-root>
        <label htmlFor="grad-year-trigger">毕业年份</label>
        <div
          id="grad-year-trigger"
          ref={yearTriggerRef}
          role="combobox"
          aria-haspopup="listbox"
          aria-controls="grad-year-popup"
          aria-expanded={yearOpen}
          tabIndex={0}
          data-testid="grad-year-trigger"
          data-options={YEARS.join(',')}
          data-committed={year === '' ? undefined : year}
          onClick={toggleYear}
        >
          {year === '' ? '请选择' : year}
        </div>
        <input type="hidden" value={year} readOnly />
      </div>

      <div data-combobox-root key={monthKey}>
        <label htmlFor="grad-month-trigger">毕业月份</label>
        <div
          id="grad-month-trigger"
          ref={monthTriggerRef}
          role="combobox"
          aria-haspopup="listbox"
          aria-controls="grad-month-popup"
          aria-expanded={monthOpen}
          tabIndex={0}
          data-testid="grad-month-trigger"
          data-options={MONTHS.join(',')}
          data-committed={month === '' ? undefined : month}
          onClick={openMonth}
        >
          {month === '' ? '请选择' : month}
        </div>
        <input type="hidden" value={month} readOnly />
      </div>

      <div>
        <button
          type="button"
          data-testid="rerender-month"
          onClick={() => {
            setMonth('');
            setMonthOpen(false);
            setMonthKey((value) => value + 1);
          }}
        >
          重新渲染月份
        </button>
      </div>

      {yearOpen
        ? createPortal(
            <div
              id="grad-year-popup"
              role="listbox"
              data-testid="grad-year-popup"
              style={{ position: 'fixed', left: yearAnchor.left, top: yearAnchor.top, background: '#fff', border: '1px solid #ccc', zIndex: 100 }}
            >
              {YEARS.map((item) => (
                <div
                  key={item}
                  role="option"
                  data-value={item}
                  data-testid={`grad-year-option-${item}`}
                  onClick={() => {
                    setYear(item);
                    setYearOpen(false);
                  }}
                >
                  {item}
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}

      {monthOpen
        ? createPortal(
            <div
              id="grad-month-popup"
              role="listbox"
              data-testid="grad-month-popup"
              style={{ position: 'fixed', left: monthAnchor.left, top: monthAnchor.top, background: '#fff', border: '1px solid #ccc', zIndex: 100 }}
            >
              <input
                id="month-search"
                type="search"
                aria-label="搜索月份"
                placeholder="搜索月份"
                value={monthQuery}
                autoComplete="off"
                onChange={(event) => setMonthQuery(event.target.value)}
              />
              {filteredMonths.map((item) => (
                <div
                  key={item}
                  role="option"
                  data-value={item}
                  data-testid={`month-option-${item}`}
                  onClick={() => {
                    setMonth(item);
                    setMonthOpen(false);
                    setMonthQuery('');
                  }}
                >
                  {item}月
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}
    </form>
  );
}

const container = document.getElementById('root');
if (container !== null) {
  ReactDOM.createRoot(container).render(
    <React.StrictMode>
      <BeisenMonthPage />
    </React.StrictMode>,
  );
}
