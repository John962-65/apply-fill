import React from 'react';
import ReactDOM from 'react-dom/client';

function NativeForm() {
  return (
    <form id="native-form" style={{ maxWidth: 560, lineHeight: 2 }}>
      <h1>React 原生输入表单（非受控）</h1>
      <div>
        <label htmlFor="full-name">姓名</label>
        <input id="full-name" name="fullName" type="text" data-testid="name" />
      </div>
      <div>
        <label htmlFor="phone">手机号码</label>
        <input id="phone" name="phone" type="tel" data-testid="phone" />
      </div>
      <div>
        <label htmlFor="email">邮箱</label>
        <input id="email" name="email" type="email" data-testid="email" />
      </div>
      <div>
        <label htmlFor="intro">个人简介</label>
        <textarea id="intro" name="intro" data-testid="intro" />
      </div>
      <div>
        <label htmlFor="salary">期望薪资（千元）</label>
        <input id="salary" name="expectedSalary" type="number" data-testid="salary" />
      </div>
      <div>
        <label htmlFor="birth">出生日期</label>
        <input id="birth" name="birthDate" type="date" data-testid="birth" />
      </div>
      <div>
        <label htmlFor="school">学校名称</label>
        <input id="school" name="school" type="text" data-testid="school" />
      </div>
      <div>
        <label htmlFor="degree">学历</label>
        <select id="degree" name="degree" data-testid="degree" defaultValue="">
          <option value="">请选择</option>
          <option>大专</option>
          <option>本科</option>
          <option>硕士</option>
          <option>博士</option>
        </select>
      </div>
      <fieldset id="gender-fieldset">
        <legend>性别</legend>
        <label>
          <input type="radio" name="gender" value="男" data-testid="gender-male" /> 男
        </label>
        <label>
          <input type="radio" name="gender" value="女" data-testid="gender-female" /> 女
        </label>
      </fieldset>
      <div>
        <label>
          <input type="checkbox" name="freshGraduate" data-testid="fresh" /> 应届毕业生
        </label>
      </div>
      <div>
        <label>
          <input type="checkbox" name="subscribe" data-testid="subscribe" /> 接收通知
        </label>
      </div>
      <div>
        <label htmlFor="nickname">昵称</label>
        <input id="nickname" name="nickname" type="text" data-testid="nickname" />
      </div>
    </form>
  );
}

const container = document.getElementById('root');
if (container !== null) {
  ReactDOM.createRoot(container).render(
    <React.StrictMode>
      <NativeForm />
    </React.StrictMode>,
  );
}
