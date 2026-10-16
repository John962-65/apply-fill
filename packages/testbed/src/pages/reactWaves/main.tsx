import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ReactDOM from 'react-dom/client';

const DEGREE_OPTIONS = ['请选择', '大专', '本科', '硕士'];
const MAJOR_BY_DEGREE: Record<string, string[]> = {
  大专: ['计算机应用技术', '会计', '电子商务'],
  本科: ['计算机科学与技术', '软件工程', '工商管理', '金融学', '土木工程'],
  硕士: ['计算机技术', '人工智能', '金融工程'],
};
const ID_TYPE_OPTIONS = ['请选择', '身份证', '护照', '其他'];
const GRAD_YEARS = ['2022', '2023', '2024', '2025', '2026', '2027', '2028'];

function WavesPage() {
  const [name, setName] = useState('');
  const [degree, setDegree] = useState('');
  const [major, setMajor] = useState('');
  const [majorOptions, setMajorOptions] = useState<string[]>([]);
  const [majorLoading, setMajorLoading] = useState(false);
  const [majorOpen, setMajorOpen] = useState(false);
  const [majorQuery, setMajorQuery] = useState('');
  const [majorAnchor, setMajorAnchor] = useState({ left: 0, top: 0 });
  const [fresh, setFresh] = useState('');
  const [gradYear, setGradYear] = useState('');
  const [gradYearOpen, setGradYearOpen] = useState(false);
  const [gradYearAnchor, setGradYearAnchor] = useState({ left: 0, top: 0 });
  const [idType, setIdType] = useState('');
  const [idExplanation, setIdExplanation] = useState('');
  const [city, setCity] = useState('');
  const [zip, setZip] = useState('');
  const majorTriggerRef = useRef<HTMLDivElement>(null);
  const gradYearTriggerRef = useRef<HTMLDivElement>(null);

  const onDegreeChange = (value: string) => {
    setDegree(value);
    setMajor('');
    setMajorOptions([]);
    if (value === '') {
      setMajorLoading(false);
      return;
    }
    setMajorLoading(true);
    window.setTimeout(() => {
      setMajorOptions(MAJOR_BY_DEGREE[value] ?? []);
      setMajorLoading(false);
    }, 150);
  };

  const onZipChange = (value: string) => {
    setZip(value);
    if (value !== '') {
      setCity('');
    }
  };

  const toggleMajor = () => {
    if (majorOpen) {
      setMajorOpen(false);
      return;
    }
    setMajorQuery('');
    const element = majorTriggerRef.current;
    if (element !== null) {
      const rect = element.getBoundingClientRect();
      setMajorAnchor({ left: rect.left, top: rect.bottom + 4 });
    }
    setMajorOpen(true);
  };

  const toggleGradYear = () => {
    if (gradYearOpen) {
      setGradYearOpen(false);
      return;
    }
    const element = gradYearTriggerRef.current;
    if (element !== null) {
      const rect = element.getBoundingClientRect();
      setGradYearAnchor({ left: rect.left, top: rect.bottom + 4 });
    }
    setGradYearOpen(true);
  };

  const filteredMajors = majorOptions.filter((item) => item.includes(majorQuery));

  return (
    <form id="waves-form" style={{ maxWidth: 640, lineHeight: 2 }}>
      <h1>React 联动波次表单</h1>
      <div>
        <label htmlFor="name">姓名</label>
        <input id="name" name="name" value={name} onChange={(event) => setName(event.target.value)} data-testid="name" />
      </div>

      <div>
        <label htmlFor="degree">学历</label>
        <select id="degree" name="degree" value={degree} onChange={(event) => onDegreeChange(event.target.value)} data-testid="degree">
          {DEGREE_OPTIONS.map((item) => (
            <option key={item} value={item === '请选择' ? '' : item}>
              {item}
            </option>
          ))}
        </select>
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
          data-options={majorOptions.join(',')}
          data-committed={major === '' ? undefined : major}
          onClick={toggleMajor}
        >
          {major === '' ? (majorLoading ? '加载中…' : '请选择') : major}
        </div>
        <input type="hidden" value={major} readOnly />
      </div>

      <fieldset id="fresh-fieldset">
        <legend>是否应届毕业生</legend>
        <label>
          <input type="radio" name="freshGraduate" value="是" checked={fresh === '是'} onChange={() => setFresh('是')} data-testid="fresh-yes" /> 是
        </label>
        <label>
          <input type="radio" name="freshGraduate" value="否" checked={fresh === '否'} onChange={() => setFresh('否')} data-testid="fresh-no" /> 否
        </label>
      </fieldset>

      {fresh === '否' ? (
        <div data-combobox-root>
          <label htmlFor="grad-year-trigger">毕业年份</label>
          <div
            id="grad-year-trigger"
            ref={gradYearTriggerRef}
            role="combobox"
            aria-haspopup="listbox"
            aria-controls="grad-year-popup"
            aria-expanded={gradYearOpen}
            tabIndex={0}
            data-testid="grad-year-trigger"
            data-options={GRAD_YEARS.join(',')}
            data-committed={gradYear === '' ? undefined : gradYear}
            onClick={toggleGradYear}
          >
            {gradYear === '' ? '请选择' : gradYear}
          </div>
          <input type="hidden" value={gradYear} readOnly />
          {gradYearOpen
            ? createPortal(
                <div
                  id="grad-year-popup"
                  role="listbox"
                  data-testid="grad-year-popup"
                  style={{ position: 'fixed', left: gradYearAnchor.left, top: gradYearAnchor.top, background: '#fff', border: '1px solid #ccc', zIndex: 100 }}
                >
                  {GRAD_YEARS.map((item) => (
                    <div
                      key={item}
                      role="option"
                      data-value={item}
                      data-testid={`grad-year-option-${item}`}
                      onClick={() => {
                        setGradYear(item);
                        setGradYearOpen(false);
                      }}
                    >
                      {item}
                    </div>
                  ))}
                </div>,
                document.body,
              )
            : null}
        </div>
      ) : null}

      <div>
        <label htmlFor="id-type">证件类型</label>
        <select id="id-type" name="idType" value={idType} onChange={(event) => setIdType(event.target.value)} data-testid="id-type">
          {ID_TYPE_OPTIONS.map((item) => (
            <option key={item} value={item === '请选择' ? '' : item}>
              {item}
            </option>
          ))}
        </select>
      </div>

      {idType === '其他' ? (
        <div>
          <label htmlFor="id-explanation">证件说明</label>
          <input
            id="id-explanation"
            name="idExplanation"
            value={idExplanation}
            onChange={(event) => setIdExplanation(event.target.value)}
            data-testid="id-explanation"
          />
        </div>
      ) : null}

      <div>
        <label htmlFor="city">城市</label>
        <input id="city" name="city" value={city} onChange={(event) => setCity(event.target.value)} data-testid="city" />
      </div>

      <div>
        <label htmlFor="zip">邮编</label>
        <input id="zip" name="zip" value={zip} onChange={(event) => onZipChange(event.target.value)} data-testid="zip" />
      </div>

      {majorOpen
        ? createPortal(
            <div
              id="major-popup"
              role="listbox"
              data-testid="major-popup"
              style={{ position: 'fixed', left: majorAnchor.left, top: majorAnchor.top, background: '#fff', border: '1px solid #ccc', zIndex: 100 }}
            >
              <input
                id="major-search"
                type="search"
                aria-label="搜索专业"
                placeholder="搜索专业"
                value={majorQuery}
                autoComplete="off"
                onChange={(event) => setMajorQuery(event.target.value)}
              />
              {filteredMajors.map((item) => (
                <div
                  key={item}
                  role="option"
                  data-value={item}
                  data-testid={`major-option-${item}`}
                  onClick={() => {
                    setMajor(item);
                    setMajorOpen(false);
                    setMajorQuery('');
                  }}
                >
                  {item}
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
      <WavesPage />
    </React.StrictMode>,
  );
}
