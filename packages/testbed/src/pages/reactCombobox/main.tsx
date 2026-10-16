import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ReactDOM from 'react-dom/client';

const SCHOOLS = ['北京大学', '清华大学', '复旦大学', '上海交通大学', '浙江大学', '南京大学', '中山大学', '武汉大学'];
const MAJORS = Array.from({ length: 60 }, (_, index) => `专业${index + 1}`);
const ITEM_HEIGHT = 28;
const WINDOW_SIZE = 8;

interface Anchor {
  left: number;
  top: number;
}

function anchorOf(element: HTMLElement | null): Anchor {
  if (element === null) {
    return { left: 0, top: 0 };
  }
  const rect = element.getBoundingClientRect();
  return { left: rect.left, top: rect.bottom + 4 };
}

function ComboboxPage() {
  const [name, setName] = useState('');
  const [school, setSchool] = useState('');
  const [schoolOpen, setSchoolOpen] = useState(false);
  const [schoolAnchor, setSchoolAnchor] = useState<Anchor>({ left: 0, top: 0 });
  const [query, setQuery] = useState('');
  const [major, setMajor] = useState('');
  const [majorOpen, setMajorOpen] = useState(false);
  const [majorAnchor, setMajorAnchor] = useState<Anchor>({ left: 0, top: 0 });
  const [scrollTop, setScrollTop] = useState(0);
  const schoolTriggerRef = useRef<HTMLDivElement>(null);
  const majorTriggerRef = useRef<HTMLDivElement>(null);

  const filteredSchools = SCHOOLS.filter((item) => item.includes(query));
  const startIndex = Math.floor(scrollTop / ITEM_HEIGHT);
  const visibleMajors = MAJORS.slice(startIndex, startIndex + WINDOW_SIZE);

  const toggleSchool = () => {
    if (schoolOpen) {
      setSchoolOpen(false);
      return;
    }
    setQuery('');
    setSchoolAnchor(anchorOf(schoolTriggerRef.current));
    setSchoolOpen(true);
  };

  const toggleMajor = () => {
    if (majorOpen) {
      setMajorOpen(false);
      return;
    }
    setScrollTop(0);
    setMajorAnchor(anchorOf(majorTriggerRef.current));
    setMajorOpen(true);
  };

  return (
    <form id="combobox-form" style={{ maxWidth: 640, lineHeight: 2 }}>
      <h1>React 组合框表单</h1>
      <div>
        <label htmlFor="name">姓名</label>
        <input id="name" name="name" value={name} onChange={(event) => setName(event.target.value)} data-testid="name" />
      </div>

      <div data-combobox-root>
        <label htmlFor="school-trigger">学校名称</label>
        <div
          id="school-trigger"
          ref={schoolTriggerRef}
          role="combobox"
          aria-haspopup="listbox"
          aria-controls="school-popup"
          aria-expanded={schoolOpen}
          tabIndex={0}
          data-testid="school-trigger"
          data-committed={school === '' ? undefined : school}
          onClick={toggleSchool}
        >
          {school === '' ? '请选择' : school}
        </div>
        <input type="hidden" value={school} readOnly />
      </div>

      <div data-combobox-root>
        <label htmlFor="major-trigger">专业</label>
        <div
          id="major-trigger"
          ref={majorTriggerRef}
          role="combobox"
          aria-haspopup="listbox"
          aria-controls="major-popup"
          aria-expanded={majorOpen}
          tabIndex={0}
          data-testid="major-trigger"
          data-committed={major === '' ? undefined : major}
          onClick={toggleMajor}
        >
          {major === '' ? '请选择' : major}
        </div>
        <input type="hidden" value={major} readOnly />
      </div>

      {schoolOpen
        ? createPortal(
            <div
              id="school-popup"
              role="listbox"
              data-testid="school-popup"
              style={{ position: 'fixed', left: schoolAnchor.left, top: schoolAnchor.top, background: '#fff', border: '1px solid #ccc', zIndex: 100 }}
            >
              <input
                id="school-search"
                type="search"
                aria-label="搜索学校"
                placeholder="搜索学校"
                value={query}
                autoComplete="off"
                onChange={(event) => setQuery(event.target.value)}
              />
              {filteredSchools.map((item) => (
                <div
                  key={item}
                  role="option"
                  data-value={item}
                  data-testid={`school-option-${item}`}
                  onClick={() => {
                    setSchool(item);
                    setSchoolOpen(false);
                    setQuery('');
                  }}
                >
                  {item}
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}

      {majorOpen
        ? createPortal(
            <div
              id="major-popup"
              role="listbox"
              data-testid="major-popup"
              style={{ position: 'fixed', left: majorAnchor.left, top: majorAnchor.top, background: '#fff', border: '1px solid #ccc', zIndex: 100 }}
            >
              <div
                id="major-scroller"
                data-testid="major-scroller"
                style={{ height: 160, overflowY: 'auto', width: 220 }}
                onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
              >
                <div style={{ height: MAJORS.length * ITEM_HEIGHT, position: 'relative' }}>
                  {visibleMajors.map((item, offset) => (
                    <div
                      key={item}
                      role="option"
                      data-value={item}
                      data-testid={`major-option-${item}`}
                      style={{ position: 'absolute', top: (startIndex + offset) * ITEM_HEIGHT, left: 0, right: 0, height: ITEM_HEIGHT }}
                      onClick={() => {
                        setMajor(item);
                        setMajorOpen(false);
                      }}
                    >
                      {item}
                    </div>
                  ))}
                </div>
              </div>
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
      <ComboboxPage />
    </React.StrictMode>,
  );
}
