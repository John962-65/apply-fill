import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ReactDOM from 'react-dom/client';

const ITEM_HEIGHT = 28;
const WINDOW_SIZE = 8;
const MAJOR_TOTAL = 30;
const MAJOR_TARGET_INDEX = 25;
const MAJORS = Array.from({ length: MAJOR_TOTAL }, (_, index) =>
  index === MAJOR_TARGET_INDEX ? '计算机科学与技术' : `专业方向${index + 1}`,
);
const DEGREES = ['大专', '本科', '硕士', '博士'];

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

function VirtualPage(): JSX.Element {
  const [name, setName] = useState('');
  const [degree, setDegree] = useState('');
  const [degreeOpen, setDegreeOpen] = useState(false);
  const [degreeAnchor, setDegreeAnchor] = useState<Anchor>({ left: 0, top: 0 });
  const [degreeOptions, setDegreeOptions] = useState<string[] | null>(null);
  const [major, setMajor] = useState('');
  const [majorOpen, setMajorOpen] = useState(false);
  const [majorAnchor, setMajorAnchor] = useState<Anchor>({ left: 0, top: 0 });
  const [school, setSchool] = useState('');
  const [schoolOpen, setSchoolOpen] = useState(false);
  const [scrollTop, setScrollTop] = useState(0);
  const degreeTriggerRef = useRef<HTMLDivElement>(null);
  const majorTriggerRef = useRef<HTMLDivElement>(null);

  const openDegree = () => {
    if (degreeOpen) {
      setDegreeOpen(false);
      return;
    }
    setDegreeAnchor(anchorOf(degreeTriggerRef.current));
    setDegreeOptions(null);
    setDegreeOpen(true);
    window.setTimeout(() => setDegreeOptions(DEGREES), 250);
  };

  const openMajor = () => {
    if (majorOpen) {
      setMajorOpen(false);
      return;
    }
    setScrollTop(0);
    setMajorAnchor(anchorOf(majorTriggerRef.current));
    setMajorOpen(true);
  };

  const startIndex = Math.floor(scrollTop / ITEM_HEIGHT);
  const visibleMajors = MAJORS.slice(startIndex, startIndex + WINDOW_SIZE);

  return (
    <form id="virtual-form" style={{ maxWidth: 640, lineHeight: 2 }}>
      <h1>虚拟滚动与异步候选项</h1>
      <div>
        <label htmlFor="name">姓名</label>
        <input id="name" name="name" value={name} onChange={(event) => setName(event.target.value)} data-testid="name" />
      </div>

      <div data-combobox-root>
        <label htmlFor="degree-trigger">学历</label>
        <div
          id="degree-trigger"
          ref={degreeTriggerRef}
          role="combobox"
          aria-haspopup="listbox"
          aria-controls="degree-popup"
          aria-expanded={degreeOpen}
          tabIndex={0}
          data-testid="degree-trigger"
          data-committed={degree === '' ? undefined : degree}
          onClick={openDegree}
          style={{ border: '1px solid #cbd5e1', borderRadius: 6, padding: '4px 8px', width: 280 }}
        >
          {degree === '' ? '请选择' : degree}
        </div>
        <input type="hidden" name="degree" id="degree" value={degree} readOnly />
        {degreeOpen
          ? createPortal(
              <div
                id="degree-popup"
                role="listbox"
                data-testid="degree-popup"
                style={{
                  position: 'fixed',
                  left: degreeAnchor.left,
                  top: degreeAnchor.top,
                  background: '#fff',
                  border: '1px solid #cbd5e1',
                  borderRadius: 6,
                  minWidth: 280,
                  maxHeight: WINDOW_SIZE * ITEM_HEIGHT,
                  overflowY: 'auto',
                  zIndex: 1000,
                }}
              >
                {degreeOptions === null ? (
                  <div style={{ height: 600, padding: '6px 10px', color: '#64748b' }}>加载中…</div>
                ) : (
                  degreeOptions.map((option) => (
                    <div
                      key={option}
                      role="option"
                      onClick={() => {
                        setDegree(option);
                        setDegreeOpen(false);
                      }}
                      style={{ padding: '4px 10px', cursor: 'pointer' }}
                    >
                      {option}
                    </div>
                  ))
                )}
              </div>,
              document.body,
            )
          : null}
      </div>

      <div data-combobox-root>
        <label htmlFor="major-trigger">所学专业</label>
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
          onClick={openMajor}
          style={{ border: '1px solid #cbd5e1', borderRadius: 6, padding: '4px 8px', width: 280 }}
        >
          {major === '' ? '请选择' : major}
        </div>
        <input type="hidden" name="major" id="major" value={major} readOnly />
        {majorOpen
          ? createPortal(
              <div
                id="major-popup"
                role="listbox"
                data-testid="major-popup"
                style={{
                  position: 'fixed',
                  left: majorAnchor.left,
                  top: majorAnchor.top,
                  background: '#fff',
                  border: '1px solid #cbd5e1',
                  borderRadius: 6,
                  width: 280,
                  zIndex: 1000,
                }}
              >
                <div
                  className="vs-scroller"
                  data-testid="major-scroller"
                  style={{ height: WINDOW_SIZE * ITEM_HEIGHT, overflowY: 'auto' }}
                  onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
                >
                  <div style={{ height: MAJOR_TOTAL * ITEM_HEIGHT, position: 'relative' }}>
                    {visibleMajors.map((option, index) => (
                      <div
                        key={option}
                        role="option"
                        onClick={() => {
                          setMajor(option);
                          setMajorOpen(false);
                        }}
                        style={{
                          position: 'absolute',
                          top: (startIndex + index) * ITEM_HEIGHT,
                          height: ITEM_HEIGHT,
                          left: 0,
                          right: 0,
                          padding: '2px 10px',
                          cursor: 'pointer',
                          boxSizing: 'border-box',
                        }}
                      >
                        {option}
                      </div>
                    ))}
                  </div>
                </div>
              </div>,
              document.body,
            )
          : null}
      </div>

      <div data-combobox-root>
        <label htmlFor="school-trigger">毕业院校</label>
        <div
          id="school-trigger"
          role="combobox"
          aria-haspopup="listbox"
          aria-controls="school-popup"
          aria-expanded={schoolOpen}
          tabIndex={0}
          data-testid="school-trigger"
          data-committed={school === '' ? undefined : school}
          onClick={() => setSchoolOpen(!schoolOpen)}
          style={{ border: '1px solid #cbd5e1', borderRadius: 6, padding: '4px 8px', width: 280 }}
        >
          {school === '' ? '请选择' : school}
        </div>
        <input type="hidden" name="school" id="school" value={school} readOnly />
        <div
          id="school-popup"
          role="listbox"
          data-testid="school-popup"
          style={{
            display: schoolOpen ? 'block' : 'none',
            border: '1px solid #cbd5e1',
            borderRadius: 6,
            width: 280,
            background: '#fff',
          }}
        >
          {['示例大学', '清华大学', '北京大学'].map((option) => (
            <div
              key={option}
              role="option"
              onClick={() => {
                setSchool(option);
                setSchoolOpen(false);
              }}
              style={{ padding: '4px 10px', cursor: 'pointer' }}
            >
              {option}
            </div>
          ))}
        </div>
      </div>
    </form>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <VirtualPage />
  </React.StrictMode>,
);
