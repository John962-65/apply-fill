import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';

function ControlledForm() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [intro, setIntro] = useState('');
  const [degree, setDegree] = useState('');
  const [gender, setGender] = useState('');
  const [fresh, setFresh] = useState(false);
  const [renderCount, setRenderCount] = useState(0);

  return (
    <form id="controlled-form" data-render-count={renderCount} style={{ maxWidth: 560, lineHeight: 2 }}>
      <h1>React 受控组件表单</h1>
      <div>
        <label htmlFor="c-name">姓名</label>
        <input id="c-name" type="text" data-testid="name" value={name} onChange={(event) => setName(event.target.value)} />
      </div>
      <div>
        <label htmlFor="c-email">邮箱</label>
        <input id="c-email" type="email" data-testid="email" value={email} onChange={(event) => setEmail(event.target.value)} />
      </div>
      <div>
        <label htmlFor="c-intro">个人简介</label>
        <textarea id="c-intro" data-testid="intro" value={intro} onChange={(event) => setIntro(event.target.value)} />
      </div>
      <div>
        <label htmlFor="c-degree">学历</label>
        <select id="c-degree" data-testid="degree" value={degree} onChange={(event) => setDegree(event.target.value)}>
          <option value="">请选择</option>
          <option>大专</option>
          <option>本科</option>
          <option>硕士</option>
          <option>博士</option>
        </select>
      </div>
      <fieldset>
        <legend>性别</legend>
        <label>
          <input
            type="radio"
            name="c-gender"
            value="男"
            data-testid="gender-male"
            checked={gender === '男'}
            onChange={() => setGender('男')}
          />{' '}
          男
        </label>
        <label>
          <input
            type="radio"
            name="c-gender"
            value="女"
            data-testid="gender-female"
            checked={gender === '女'}
            onChange={() => setGender('女')}
          />{' '}
          女
        </label>
      </fieldset>
      <div>
        <label>
          <input
            type="checkbox"
            data-testid="fresh"
            checked={fresh}
            onChange={(event) => setFresh(event.target.checked)}
          />{' '}
          应届毕业生
        </label>
      </div>
      <button type="button" data-testid="rerender" onClick={() => setRenderCount((count) => count + 1)}>
        重新渲染
      </button>
    </form>
  );
}

const container = document.getElementById('root');
if (container !== null) {
  ReactDOM.createRoot(container).render(
    <React.StrictMode>
      <ControlledForm />
    </React.StrictMode>,
  );
}
