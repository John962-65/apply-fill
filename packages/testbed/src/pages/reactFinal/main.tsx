import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ReactDOM from 'react-dom/client';

declare global {
  interface Window {
    __finalSubmitClicks?: number;
  }
}

const YEARS = ['2015', '2016', '2017', '2018', '2019', '2020', '2021', '2022', '2023', '2024', '2025', '2026'];
const MONTHS = Array.from({ length: 12 }, (_, index) => String(index + 1));
const CITY_OPTIONS = ['北京市', '上海市', '深圳市'];

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

interface EducationEntry {
  key: number;
  school: string;
  degree: string;
  major: string;
  gradYear: string;
  gradMonth: string;
}

interface ProjectEntry {
  key: number;
  name: string;
  role: string;
  description: string;
}

let nextKey = 100;

function YearMonthFields({
  idBase,
  entry,
  onChange,
}: {
  idBase: string;
  entry: EducationEntry;
  onChange: (patch: Partial<EducationEntry>) => void;
}): JSX.Element {
  const [yearOpen, setYearOpen] = useState(false);
  const [yearAnchor, setYearAnchor] = useState<Anchor>({ left: 0, top: 0 });
  const [monthOpen, setMonthOpen] = useState(false);
  const [monthQuery, setMonthQuery] = useState('');
  const [monthAnchor, setMonthAnchor] = useState<Anchor>({ left: 0, top: 0 });
  const yearRef = useRef<HTMLDivElement>(null);
  const monthRef = useRef<HTMLDivElement>(null);

  const filteredMonths = MONTHS.filter((item) => item.includes(monthQuery));

  return (
    <>
      <span data-combobox-root style={{ display: 'inline-block', marginRight: 12 }}>
        <label htmlFor={`${idBase}-year-trigger`}>毕业年份</label>
        <div
          id={`${idBase}-year-trigger`}
          ref={yearRef}
          role="combobox"
          aria-haspopup="listbox"
          aria-controls={`${idBase}-year-popup`}
          aria-expanded={yearOpen}
          tabIndex={0}
          data-testid={`${idBase}-year-trigger`}
          data-options={YEARS.join(',')}
          data-committed={entry.gradYear === '' ? undefined : entry.gradYear}
          onClick={() => {
            if (yearOpen) {
              setYearOpen(false);
              return;
            }
            setYearAnchor(anchorOf(yearRef.current));
            setYearOpen(true);
          }}
        >
          {entry.gradYear === '' ? '请选择' : entry.gradYear}
        </div>
        <input type="hidden" name="gradYear" value={entry.gradYear} readOnly />
        {yearOpen
          ? createPortal(
              <div
                id={`${idBase}-year-popup`}
                role="listbox"
                data-testid={`${idBase}-year-popup`}
                style={{ position: 'fixed', left: yearAnchor.left, top: yearAnchor.top, background: '#fff', border: '1px solid #ccc', zIndex: 1000 }}
              >
                {YEARS.map((item) => (
                  <div
                    key={item}
                    role="option"
                    onClick={() => {
                      onChange({ gradYear: item });
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
      </span>

      <span data-combobox-root key={entry.key}>
        <label htmlFor={`${idBase}-month-trigger`}>毕业月份</label>
        <div
          id={`${idBase}-month-trigger`}
          ref={monthRef}
          role="combobox"
          aria-haspopup="listbox"
          aria-controls={`${idBase}-month-popup`}
          aria-expanded={monthOpen}
          tabIndex={0}
          data-testid={`${idBase}-month-trigger`}
          data-options={MONTHS.join(',')}
          data-committed={entry.gradMonth === '' ? undefined : entry.gradMonth}
          onClick={() => {
            if (monthOpen) {
              setMonthOpen(false);
              return;
            }
            setMonthQuery('');
            setMonthAnchor(anchorOf(monthRef.current));
            setMonthOpen(true);
          }}
        >
          {entry.gradMonth === '' ? '请选择' : entry.gradMonth}
        </div>
        <input type="hidden" name="gradMonth" value={entry.gradMonth} readOnly />
        {monthOpen
          ? createPortal(
              <div
                id={`${idBase}-month-popup`}
                role="listbox"
                data-testid={`${idBase}-month-popup`}
                style={{ position: 'fixed', left: monthAnchor.left, top: monthAnchor.top, background: '#fff', border: '1px solid #ccc', zIndex: 1000 }}
              >
                <input
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
                    onClick={() => {
                      onChange({ gradMonth: item });
                      setMonthOpen(false);
                    }}
                  >
                    {item}
                  </div>
                ))}
              </div>,
              document.body,
            )
          : null}
      </span>
    </>
  );
}

function FinalPage(): JSX.Element {
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [city, setCity] = useState('');
  const [cityOpen, setCityOpen] = useState(false);
  const [cityAnchor, setCityAnchor] = useState<Anchor>({ left: 0, top: 0 });
  const [educations, setEducations] = useState<EducationEntry[]>([
    { key: nextKey++, school: '', degree: '', major: '', gradYear: '', gradMonth: '' },
  ]);
  const [projects, setProjects] = useState<ProjectEntry[]>([{ key: nextKey++, name: '', role: '', description: '' }]);
  const [fresh, setFresh] = useState('');
  const [salary, setSalary] = useState('');
  const [essay, setEssay] = useState('');
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [fileName, setFileName] = useState('');
  const cityRef = useRef<HTMLDivElement>(null);

  const patchEducation = (key: number, patch: Partial<EducationEntry>) => {
    setEducations((list) => list.map((entry) => (entry.key === key ? { ...entry, ...patch } : entry)));
  };
  const patchProject = (key: number, patch: Partial<ProjectEntry>) => {
    setProjects((list) => list.map((entry) => (entry.key === key ? { ...entry, ...patch } : entry)));
  };

  useEffect(() => {
    if (step === 1 && name !== '' && phone !== '' && email !== '') {
      const timer = window.setTimeout(() => setStep(2), 300);
      return () => window.clearTimeout(timer);
    }
    if (
      step === 2 &&
      educations.length >= 2 &&
      educations.every((entry) => entry.school !== '' && entry.gradYear !== '' && entry.gradMonth !== '')
    ) {
      const timer = window.setTimeout(() => setStep(3), 300);
      return () => window.clearTimeout(timer);
    }
    if (step === 3 && projects.length >= 3 && projects.every((entry) => entry.name !== '')) {
      const timer = window.setTimeout(() => setStep(4), 300);
      return () => window.clearTimeout(timer);
    }
    if (step === 4 && fresh === '否' && salary !== '' && essay !== '') {
      const timer = window.setTimeout(() => setStep(5), 300);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [step, name, phone, email, educations, projects, fresh, salary, essay]);

  return (
    <form id="final-form" style={{ maxWidth: 720, lineHeight: 2 }}>
      <h1>最终验收申请表单</h1>
      <div data-testid="final-step">当前步骤：{step}</div>

      {step === 1 ? (
        <section data-step="1">
          <div>
            <label htmlFor="name">姓名</label>
            <input id="name" name="name" value={name} onChange={(event) => setName(event.target.value)} data-testid="name" />
          </div>
          <div>
            <label htmlFor="phone">手机号</label>
            <input id="phone" name="phone" value={phone} onChange={(event) => setPhone(event.target.value)} data-testid="phone" />
          </div>
          <div>
            <label htmlFor="email">邮箱</label>
            <input id="email" name="email" value={email} onChange={(event) => setEmail(event.target.value)} data-testid="email" />
          </div>
          <div data-combobox-root>
            <label htmlFor="city-trigger">城市</label>
            <div
              id="city-trigger"
              ref={cityRef}
              role="combobox"
              aria-haspopup="listbox"
              aria-controls="city-popup"
              aria-expanded={cityOpen}
              tabIndex={0}
              data-testid="city-trigger"
              data-options={CITY_OPTIONS.join(',')}
              data-committed={city === '' ? undefined : city}
              onClick={() => {
                if (cityOpen) {
                  setCityOpen(false);
                  return;
                }
                setCityAnchor(anchorOf(cityRef.current));
                setCityOpen(true);
              }}
            >
              {city === '' ? '请选择' : city}
            </div>
            <input type="hidden" name="city" value={city} readOnly />
            {cityOpen
              ? createPortal(
                  <div
                    id="city-popup"
                    role="listbox"
                    data-testid="city-popup"
                    style={{ position: 'fixed', left: cityAnchor.left, top: cityAnchor.top, background: '#fff', border: '1px solid #ccc', zIndex: 1000 }}
                  >
                    {CITY_OPTIONS.map((item) => (
                      <div
                        key={item}
                        role="option"
                        onClick={() => {
                          setCity(item);
                          setCityOpen(false);
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
        </section>
      ) : null}

      {step === 2 ? (
        <section data-step="2">
          <h2>教育经历</h2>
          <div data-testid="edu-count">教育经历数量：{educations.length}</div>
          <div className="edu-list">
            {educations.map((entry, index) => (
            <div key={entry.key} data-testid={`edu-${index}`} className="edu-item">
              <div>
                <label htmlFor={`edu-${index}-school`}>学校名称</label>
                <input
                  id={`edu-${index}-school`}
                  name={`school-${index}`}
                  value={entry.school}
                  onChange={(event) => patchEducation(entry.key, { school: event.target.value })}
                  data-testid={`edu-${index}-school`}
                />
              </div>
              <div>
                <label htmlFor={`edu-${index}-degree`}>学历</label>
                <select
                  id={`edu-${index}-degree`}
                  name={`degree-${index}`}
                  value={entry.degree}
                  onChange={(event) => patchEducation(entry.key, { degree: event.target.value })}
                  data-testid={`edu-${index}-degree`}
                >
                  <option value="">请选择</option>
                  <option value="大专">大专</option>
                  <option value="本科">本科</option>
                  <option value="硕士">硕士</option>
                  <option value="博士">博士</option>
                </select>
              </div>
              <div>
                <label htmlFor={`edu-${index}-major`}>专业</label>
                <input
                  id={`edu-${index}-major`}
                  name={`major-${index}`}
                  value={entry.major}
                  onChange={(event) => patchEducation(entry.key, { major: event.target.value })}
                  data-testid={`edu-${index}-major`}
                />
              </div>
              <div>
                <YearMonthFields idBase={`edu-${index}-grad`} entry={entry} onChange={(patch) => patchEducation(entry.key, patch)} />
              </div>
            </div>
            ))}
          </div>
          <button
            type="button"
            data-applyfill-add
            data-testid="add-education"
            onClick={() => setEducations((list) => [...list, { key: nextKey++, school: '', degree: '', major: '', gradYear: '', gradMonth: '' }])}
          >
            添加教育经历
          </button>
        </section>
      ) : null}

      {step === 3 ? (
        <section data-step="3">
          <h2>项目经历</h2>
          <div data-testid="proj-count">项目经历数量：{projects.length}</div>
          <div className="proj-list">
            {projects.map((entry, index) => (
            <div key={entry.key} data-testid={`proj-${index}`} className="proj-item">
              <div>
                <label htmlFor={`proj-${index}-name`}>项目名称</label>
                <input
                  id={`proj-${index}-name`}
                  name={`projectName-${index}`}
                  value={entry.name}
                  onChange={(event) => patchProject(entry.key, { name: event.target.value })}
                  data-testid={`proj-${index}-name`}
                />
              </div>
              <div>
                <label htmlFor={`proj-${index}-role`}>担任角色</label>
                <input
                  id={`proj-${index}-role`}
                  name={`projectRole-${index}`}
                  value={entry.role}
                  onChange={(event) => patchProject(entry.key, { role: event.target.value })}
                  data-testid={`proj-${index}-role`}
                />
              </div>
              <div>
                <label htmlFor={`proj-${index}-desc`}>项目描述</label>
                <textarea
                  id={`proj-${index}-desc`}
                  name={`projectDesc-${index}`}
                  value={entry.description}
                  onChange={(event) => patchProject(entry.key, { description: event.target.value })}
                  data-testid={`proj-${index}-desc`}
                />
              </div>
            </div>
            ))}
          </div>
          <button
            type="button"
            data-applyfill-add
            data-testid="add-project"
            onClick={() => setProjects((list) => [...list, { key: nextKey++, name: '', role: '', description: '' }])}
          >
            添加项目经历
          </button>
        </section>
      ) : null}

      {step === 4 ? (
        <section data-step="4">
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
            <div>
              <label htmlFor="salary">期望薪资（千元）</label>
              <input id="salary" name="expectedSalary" type="number" value={salary} onChange={(event) => setSalary(event.target.value)} data-testid="salary" />
            </div>
          ) : null}
          <div>
            <label htmlFor="essay">自荐理由</label>
            <textarea id="essay" name="essay" value={essay} onChange={(event) => setEssay(event.target.value)} data-testid="essay" />
          </div>
        </section>
      ) : null}

      {step === 5 ? (
        <section data-step="5">
          <div style={{ border: '1px dashed #999', borderRadius: 8, padding: 16 }}>
            <label htmlFor="final-upload">简历附件（PDF）</label>
            <input
              id="final-upload"
              name="resumeFile"
              type="file"
              accept=".pdf,application/pdf"
              onChange={(event) => {
                const file = event.target.files?.[0];
                setFileName(file === undefined ? '' : file.name);
              }}
              data-testid="final-upload-input"
            />
            <div data-testid="final-upload-status" data-file-accepted={fileName !== '' ? 'true' : 'false'}>
              {fileName === '' ? '尚未选择文件' : `已选择：${fileName}`}
            </div>
          </div>
          <div>
            <label>
              <input
                type="checkbox"
                checked={confirmChecked}
                onChange={(event) => setConfirmChecked(event.target.checked)}
                data-testid="final-confirm"
              />{' '}
              确认信息真实有效
            </label>
          </div>
          <button
            type="button"
            data-testid="final-submit"
            onClick={() => {
              window.__finalSubmitClicks = (window.__finalSubmitClicks ?? 0) + 1;
            }}
          >
            提交申请
          </button>
        </section>
      ) : null}
    </form>
  );
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <FinalPage />
  </React.StrictMode>,
);
