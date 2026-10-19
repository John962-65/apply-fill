import React, { useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';

interface EducationItem {
  uid: number;
  school: string;
  degree: string;
  major: string;
}

interface ProjectItem {
  uid: number;
  name: string;
  role: string;
  desc: string;
}

const DEGREE_OPTIONS = ['', '大专', '本科', '硕士', '博士'];

function RepeaterPage() {
  const roleVariant = new URLSearchParams(window.location.search).get('role');
  const roleLabel = roleVariant === 'unknown' ? '责任范围' : roleVariant === 'generic' ? '职位' : '担任角色';
  const [education, setEducation] = useState<EducationItem[]>([{ uid: 1, school: '', degree: '', major: '' }]);
  const [projects, setProjects] = useState<ProjectItem[]>([{ uid: 1, name: '', role: '', desc: '' }]);
  const [projectsKey, setProjectsKey] = useState(0);
  const uidRef = useRef(100);

  const nextUid = () => {
    uidRef.current += 1;
    return uidRef.current;
  };

  const updateEducation = (uid: number, patch: Partial<EducationItem>) => {
    setEducation((items) => items.map((item) => (item.uid === uid ? { ...item, ...patch } : item)));
  };

  const updateProject = (uid: number, patch: Partial<ProjectItem>) => {
    setProjects((items) => items.map((item) => (item.uid === uid ? { ...item, ...patch } : item)));
  };

  const addEducation = () => {
    const uid = nextUid();
    setEducation((items) => [...items, { uid, school: '', degree: '', major: '' }]);
  };

  const addProject = () => {
    const uid = nextUid();
    setProjects((items) => [...items, { uid, name: '', role: '', desc: '' }]);
  };

  const insertBlankProject = () => {
    const uid = nextUid();
    setProjects((items) => [{ uid, name: '', role: '', desc: '' }, ...items]);
  };

  return (
    <form id="repeater-form" style={{ maxWidth: 640, lineHeight: 2 }}>
      <h1>React 重复经历表单</h1>

      <section id="education-section">
        <h2>教育经历</h2>
        <div className="edu-list">
          {education.map((item) => (
            <div className="edu-item" data-testid={`edu-item-${item.uid}`} key={item.uid}>
              <div>
                <label htmlFor={`edu-school-${item.uid}`}>学校名称</label>
                <input
                  id={`edu-school-${item.uid}`}
                  name="school"
                  value={item.school}
                  data-testid={`edu-school-${item.uid}`}
                  onChange={(event) => updateEducation(item.uid, { school: event.target.value })}
                />
              </div>
              <div>
                <label htmlFor={`edu-degree-${item.uid}`}>学历</label>
                <select
                  id={`edu-degree-${item.uid}`}
                  name="degree"
                  value={item.degree}
                  data-testid={`edu-degree-${item.uid}`}
                  onChange={(event) => updateEducation(item.uid, { degree: event.target.value })}
                >
                  {DEGREE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option === '' ? '请选择' : option}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor={`edu-major-${item.uid}`}>专业</label>
                <input
                  id={`edu-major-${item.uid}`}
                  name="major"
                  value={item.major}
                  data-testid={`edu-major-${item.uid}`}
                  onChange={(event) => updateEducation(item.uid, { major: event.target.value })}
                />
              </div>
            </div>
          ))}
        </div>
        <button type="button" data-testid="add-education" onClick={addEducation}>
          添加教育
        </button>
      </section>

      <section id="project-section">
        <h2>项目经历</h2>
        <div className="project-list" key={projectsKey}>
          {projects.map((item) => (
            <div className="project-item" data-testid={`project-item-${item.uid}`} key={item.uid}>
              <div>
                <label htmlFor={`project-name-${item.uid}`}>项目名称</label>
                <input
                  id={`project-name-${item.uid}`}
                  name="projectName"
                  value={item.name}
                  data-testid={`project-name-${item.uid}`}
                  onChange={(event) => updateProject(item.uid, { name: event.target.value })}
                />
              </div>
              <div>
                <label htmlFor={`project-role-${item.uid}`}>{roleLabel}</label>
                <input
                  id={`project-role-${item.uid}`}
                  name="projectRole"
                  value={item.role}
                  data-testid={`project-role-${item.uid}`}
                  onChange={(event) => updateProject(item.uid, { role: event.target.value })}
                />
              </div>
              <div>
                <label htmlFor={`project-desc-${item.uid}`}>项目描述</label>
                <textarea
                  id={`project-desc-${item.uid}`}
                  name="projectDesc"
                  value={item.desc}
                  data-testid={`project-desc-${item.uid}`}
                  onChange={(event) => updateProject(item.uid, { desc: event.target.value })}
                />
              </div>
            </div>
          ))}
        </div>
        <button type="button" data-testid="add-project" onClick={addProject}>
          添加项目
        </button>
        <button
          type="button"
          data-testid="remove-middle-project"
          onClick={() => setProjects((items) => items.filter((_item, index) => index !== 1))}
        >
          删除中间项目
        </button>
        <button type="button" data-testid="insert-blank-project" onClick={insertBlankProject}>
          插入空白项目
        </button>
        <button type="button" data-testid="remount-projects" onClick={() => setProjectsKey((value) => value + 1)}>
          整块重绘项目
        </button>
        <button
          type="button"
          data-testid="dup-project"
          onClick={() =>
            setProjects((items) => {
              const first = items[0];
              if (first === undefined || items.length < 2) {
                return items;
              }
              return items.map((item, index) =>
                index === 1 ? { ...item, name: first.name, role: first.role, desc: first.desc } : item,
              );
            })
          }
        >
          第二项与第一项同名
        </button>
      </section>
    </form>
  );
}

const container = document.getElementById('root');
if (container !== null) {
  ReactDOM.createRoot(container).render(
    <React.StrictMode>
      <RepeaterPage />
    </React.StrictMode>,
  );
}
