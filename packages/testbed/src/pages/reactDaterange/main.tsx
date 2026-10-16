import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ReactDOM from 'react-dom/client';

interface Anchor {
  left: number;
  top: number;
}

const pad = (value: number) => String(value).padStart(2, '0');

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

interface PanelProps {
  year: number;
  month: number;
  onPrev: () => void;
  onNext: () => void;
  onPick: (day: number) => void;
}

function RangePanel({ year, month, onPrev, onNext, onPick }: PanelProps) {
  const days = daysInMonth(year, month);
  return (
    <div className="date-panel" style={{ display: 'inline-block', margin: 8, verticalAlign: 'top' }}>
      <div>
        <button type="button" aria-label="上个月" onClick={onPrev}>
          ‹
        </button>
        <span className="date-header">{`${year}年${month}月`}</span>
        <button type="button" aria-label="下个月" onClick={onNext}>
          ›
        </button>
      </div>
      <div role="grid" style={{ width: 200 }}>
        {Array.from({ length: days }, (_, index) => index + 1).map((day) => (
          <button type="button" key={day} data-day={day} onClick={() => onPick(day)} style={{ width: '13%', margin: 1 }}>
            {day}
          </button>
        ))}
      </div>
    </div>
  );
}

function DateRangePage() {
  const [name, setName] = useState('');
  const [rangeText, setRangeText] = useState('');
  const [startPick, setStartPick] = useState('');
  const [present, setPresent] = useState(false);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<Anchor>({ left: 0, top: 0 });
  const [left, setLeft] = useState({ year: 2019, month: 6 });
  const [right, setRight] = useState({ year: 2019, month: 6 });
  const triggerRef = useRef<HTMLDivElement>(null);

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
    setLeft({ year: 2019, month: 6 });
    setRight({ year: 2019, month: 6 });
    setOpen(true);
  };

  const step = (
    current: { year: number; month: number },
    delta: number,
  ): { year: number; month: number } => {
    let month = current.month + delta;
    let year = current.year;
    if (month < 1) {
      month = 12;
      year -= 1;
    }
    if (month > 12) {
      month = 1;
      year += 1;
    }
    return { year, month };
  };

  const pickStart = (day: number) => {
    setStartPick(`${left.year}-${pad(left.month)}-${pad(day)}`);
    setRight({ year: left.year, month: left.month });
  };

  const pickEnd = (day: number) => {
    setRangeText(`${startPick} ~ ${right.year}-${pad(right.month)}-${pad(day)}`);
    setOpen(false);
  };

  const popup =
    open &&
    createPortal(
      <div
        id="range-popup"
        role="dialog"
        data-testid="range-popup"
        style={{ position: 'absolute', left: anchor.left, top: anchor.top, background: '#fff', border: '1px solid #d9d9d9', padding: 8, zIndex: 10 }}
      >
        <RangePanel
          year={left.year}
          month={left.month}
          onPrev={() => setLeft(step(left, -1))}
          onNext={() => setLeft(step(left, 1))}
          onPick={pickStart}
        />
        <RangePanel
          year={right.year}
          month={right.month}
          onPrev={() => setRight(step(right, -1))}
          onNext={() => setRight(step(right, 1))}
          onPick={pickEnd}
        />
        <div>
          <label>
            <input
              type="checkbox"
              checked={present}
              onChange={(event) => {
                setPresent(event.target.checked);
              }}
              onClick={() => {
                if (startPick === '') {
                  return;
                }
                setRangeText(`${startPick} ~ 至今`);
                setOpen(false);
              }}
            />{' '}
            至今
          </label>
        </div>
      </div>,
      document.body,
    );

  return (
    <form id="daterange-form" style={{ maxWidth: 640, lineHeight: 2 }}>
      <h1>日期范围选择表单</h1>
      <div>
        <label htmlFor="name">姓名</label>
        <input id="name" name="name" value={name} onChange={(event) => setName(event.target.value)} data-testid="name" />
      </div>
      <div data-combobox-root>
        <label htmlFor="range-trigger">在校时间</label>
        <div
          id="range-trigger"
          ref={triggerRef}
          role="combobox"
          aria-haspopup="dialog"
          aria-controls="range-popup"
          aria-expanded={open}
          tabIndex={0}
          data-testid="range-trigger"
          data-committed={rangeText === '' ? undefined : rangeText}
          onClick={toggle}
        >
          {rangeText === '' ? '开始日期 结束日期' : rangeText}
        </div>
        <input type="hidden" value={rangeText} readOnly />
      </div>
      {popup}
    </form>
  );
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <DateRangePage />
  </React.StrictMode>,
);
