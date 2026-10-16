import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ReactDOM from 'react-dom/client';

const REGIONS: Record<string, Record<string, string[]>> = {
  广东省: {
    深圳市: ['南山区', '福田区', '宝安区'],
    广州市: ['天河区', '越秀区'],
  },
  北京市: {
    北京市: ['朝阳区', '海淀区'],
  },
  浙江省: {
    杭州市: ['西湖区', '余杭区'],
  },
  上海市: {
    上海市: ['浦东新区', '徐汇区'],
  },
};

function optionsFor(path: string[]): string[] {
  if (path.length === 0) {
    return Object.keys(REGIONS);
  }
  const province = path[0] ?? '';
  const cityMap = REGIONS[province];
  if (path.length === 1) {
    return cityMap === undefined ? [] : Object.keys(cityMap);
  }
  const city = path[1] ?? '';
  return cityMap?.[city] ?? [];
}

function CascaderPage() {
  const [name, setName] = useState('');
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState<string[]>([]);
  const [anchor, setAnchor] = useState({ left: 0, top: 0 });
  const triggerRef = useRef<HTMLDivElement>(null);

  const pathText = path.join(' / ');
  const levelCount = Math.min(path.length + 1, 3);
  const columns: string[][] = [];
  for (let level = 0; level < levelCount; level += 1) {
    columns.push(optionsFor(path.slice(0, level)));
  }

  const selectLevel = (level: number, value: string) => {
    const next = [...path.slice(0, level), value];
    setPath(next);
    const isLeaf = level >= 2 || optionsFor(next).length === 0;
    if (isLeaf) {
      setOpen(false);
    }
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
    setOpen(true);
  };

  return (
    <form id="cascader-form" style={{ maxWidth: 640, lineHeight: 2 }}>
      <h1>React 级联地区表单</h1>
      <div>
        <label htmlFor="name">姓名</label>
        <input id="name" name="name" value={name} onChange={(event) => setName(event.target.value)} data-testid="name" />
      </div>
      <div data-combobox-root>
        <label htmlFor="location-trigger">所在地区</label>
        <div
          id="location-trigger"
          ref={triggerRef}
          role="combobox"
          aria-haspopup="tree"
          aria-controls="location-popup"
          aria-expanded={open}
          tabIndex={0}
          data-testid="location-trigger"
          data-committed={pathText === '' ? undefined : pathText}
          onClick={toggle}
        >
          {pathText === '' ? '请选择' : pathText}
        </div>
        <input type="hidden" value={pathText} readOnly />
      </div>
      <div>
        <button type="button" data-testid="location-reset" onClick={() => setPath([])}>
          清空地区
        </button>
      </div>

      {open
        ? createPortal(
            <div
              id="location-popup"
              role="dialog"
              aria-label="地区选择"
              data-testid="location-popup"
              style={{ position: 'fixed', left: anchor.left, top: anchor.top, display: 'flex', background: '#fff', border: '1px solid #ccc', zIndex: 100 }}
            >
              {columns.map((options, level) => (
                <div
                  key={level}
                  role="listbox"
                  data-testid={`location-column-${level}`}
                  aria-label={`第${level + 1}级`}
                  style={{ minWidth: 120, maxHeight: 200, overflowY: 'auto', borderRight: level < columns.length - 1 ? '1px solid #eee' : 'none' }}
                >
                  {options.map((item) => (
                    <div
                      key={item}
                      role="option"
                      data-value={item}
                      data-testid={`location-option-${level}-${item}`}
                      onClick={() => selectLevel(level, item)}
                    >
                      {item}
                    </div>
                  ))}
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
      <CascaderPage />
    </React.StrictMode>,
  );
}
