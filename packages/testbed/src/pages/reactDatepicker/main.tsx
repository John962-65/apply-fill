import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ReactDOM from 'react-dom/client';

declare global {
  interface Window {
    __dateClickCount?: number;
  }
}

interface Anchor {
  left: number;
  top: number;
}

const pad = (value: number) => String(value).padStart(2, '0');

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function DatePickerPage() {
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<Anchor>({ left: 0, top: 0 });
  const [view, setView] = useState<'day' | 'year' | 'month'>('day');
  const [viewYear, setViewYear] = useState(2014);
  const [viewMonth, setViewMonth] = useState(6);
  const [decadeStart, setDecadeStart] = useState(2010);
  const triggerRef = useRef<HTMLDivElement>(null);

  const deadNav = new URLSearchParams(window.location.search).has('deadnav');

  const bump = () => {
    window.__dateClickCount = (window.__dateClickCount ?? 0) + 1;
  };

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    const element = triggerRef.current;
    if (element !== null) {
      const rect = element.getBoundingClientRect();
      setAnchor({ left: rect.left, top: rect.bottom + 4 });
    }
    setView('day');
    setOpen(true);
  };

  const commit = (text: string) => {
    setValue(text);
    setOpen(false);
  };

  const days = daysInMonth(viewYear, viewMonth);

  const popup =
    open &&
    createPortal(
      <div
        id="date-popup"
        role="dialog"
        data-testid="date-popup"
        style={{ position: 'absolute', left: anchor.left, top: anchor.top, background: '#fff', border: '1px solid #d9d9d9', padding: 8, zIndex: 10, width: 240 }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          {view === 'day' && (
            <button
              type="button"
              aria-label="上个月"
              onClick={() => {
                bump();
                if (deadNav) {
                  return;
                }
                let month = viewMonth - 1;
                let year = viewYear;
                if (month < 1) {
                  month = 12;
                  year -= 1;
                }
                setViewMonth(month);
                setViewYear(year);
              }}
            >
              ‹
            </button>
          )}
          {view === 'year' && (
            <button
              type="button"
              aria-label="上十年"
              onClick={() => {
                bump();
                if (deadNav) {
                  return;
                }
                setDecadeStart(decadeStart - 10);
              }}
            >
              «
            </button>
          )}
          <button
            type="button"
            className="date-header"
            aria-label="切换年视图"
            onClick={() => {
              if (view === 'day') {
                setDecadeStart(Math.floor(viewYear / 10) * 10);
                setView('year');
              } else if (view === 'month') {
                setView('day');
              }
            }}
            style={{ border: 'none', background: 'none', cursor: 'pointer' }}
          >
            {view === 'day' ? `${viewYear}年${viewMonth}月` : view === 'month' ? `${viewYear}年` : `${decadeStart}年-${decadeStart + 9}年`}
          </button>
          {view === 'day' && (
            <button
              type="button"
              aria-label="下个月"
              onClick={() => {
                bump();
                if (deadNav) {
                  return;
                }
                let month = viewMonth + 1;
                let year = viewYear;
                if (month > 12) {
                  month = 1;
                  year += 1;
                }
                setViewMonth(month);
                setViewYear(year);
              }}
            >
              ›
            </button>
          )}
          {view === 'year' && (
            <button
              type="button"
              aria-label="下十年"
              onClick={() => {
                bump();
                if (deadNav) {
                  return;
                }
                setDecadeStart(decadeStart + 10);
              }}
            >
              »
            </button>
          )}
        </div>
        {view === 'year' && (
          <div role="grid">
            {Array.from({ length: 10 }, (_, index) => decadeStart + index).map((year) => (
              <button
                type="button"
                key={year}
                onClick={() => {
                  bump();
                  if (deadNav) {
                    return;
                  }
                  setViewYear(year);
                  setView('month');
                }}
                style={{ width: '30%', margin: 2 }}
              >
                {year}
              </button>
            ))}
          </div>
        )}
        {view === 'month' && (
          <div role="grid">
            {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => (
              <button
                type="button"
                key={month}
                onClick={() => {
                  bump();
                  if (deadNav) {
                    return;
                  }
                  setViewMonth(month);
                  setView('day');
                }}
                style={{ width: '30%', margin: 2 }}
              >
                {month}月
              </button>
            ))}
          </div>
        )}
        {view === 'day' && (
          <div role="grid">
            {Array.from({ length: days }, (_, index) => index + 1).map((day) => (
              <button
                type="button"
                key={day}
                data-day={day}
                onClick={() => {
                  bump();
                  if (deadNav) {
                    return;
                  }
                  commit(`${viewYear}-${pad(viewMonth)}-${pad(day)}`);
                }}
                style={{ width: '13%', margin: 1 }}
              >
                {day}
              </button>
            ))}
          </div>
        )}
      </div>,
      document.body,
    );

  return (
    <form id="datepicker-form" style={{ maxWidth: 560, lineHeight: 2 }}>
      <h1>日期选择器表单</h1>
      <div>
        <label htmlFor="name">姓名</label>
        <input id="name" name="name" value={name} onChange={(event) => setName(event.target.value)} data-testid="name" />
      </div>
      <div data-combobox-root>
        <label htmlFor="graddate-trigger">毕业日期</label>
        <div
          id="graddate-trigger"
          ref={triggerRef}
          role="combobox"
          aria-haspopup="dialog"
          aria-controls="date-popup"
          aria-expanded={open}
          tabIndex={0}
          data-testid="graddate-trigger"
          data-committed={value === '' ? undefined : value}
          onClick={toggle}
        >
          {value === '' ? '请选择日期' : value}
        </div>
        <input type="hidden" value={value} readOnly />
      </div>
      {popup}
    </form>
  );
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <DatePickerPage />
  </React.StrictMode>,
);
