import React, { useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom/client';

function ValidatePage() {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [city, setCity] = useState('');
  const [showSalary, setShowSalary] = useState(false);

  const phoneError = useMemo(() => (phone !== '' && !/^1\d{10}$/.test(phone) ? '手机号格式不正确' : ''), [phone]);
  const emailError = useMemo(
    () => (email !== '' && !email.endsWith('@corp.example.com') ? '必须使用企业邮箱（@corp.example.com）' : ''),
    [email],
  );

  useEffect(() => {
    if (name === '') {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      setShowSalary(true);
    }, 120);
    return () => window.clearTimeout(timer);
  }, [name]);

  return (
    <div style={{ maxWidth: 560, lineHeight: 2.2 }}>
      <h1>终态校验表单</h1>
      <form id="validate-form">
        <div className="form-item">
          <label htmlFor="v-name">姓名</label>
          <input id="v-name" name="name" value={name} onChange={(event) => setName(event.target.value)} data-testid="v-name" />
        </div>
        <div className="form-item">
          <label htmlFor="v-phone">联系电话</label>
          <input
            id="v-phone"
            name="phone"
            value={phone}
            aria-invalid={phoneError !== ''}
            onChange={(event) => setPhone(event.target.value)}
            data-testid="v-phone"
          />
          {phoneError !== '' ? (
            <span className="error" data-testid="v-phone-error">
              {phoneError}
            </span>
          ) : null}
        </div>
        <div className="form-item">
          <label htmlFor="v-email">邮箱</label>
          <input
            id="v-email"
            name="email"
            value={email}
            aria-invalid={emailError !== ''}
            onChange={(event) => setEmail(event.target.value)}
            data-testid="v-email"
          />
          {emailError !== '' ? (
            <span className="error" data-testid="v-email-error">
              {emailError}
            </span>
          ) : null}
        </div>
        <div className="form-item">
          <label htmlFor="v-city">所在城市</label>
          <input id="v-city" name="city" value={city} onChange={(event) => setCity(event.target.value)} data-testid="v-city" />
        </div>
        {showSalary ? (
          <>
            <div className="form-item">
              <label htmlFor="v-salary">期望薪资（元/月）</label>
              <input id="v-salary" name="salary" required data-testid="v-salary" />
            </div>
            <div className="form-item">
              <label htmlFor="v-politics">政治面貌</label>
              <select id="v-politics" name="politics" required defaultValue="" data-testid="v-politics">
                <option value="">请选择</option>
                <option value="群众">群众</option>
                <option value="中共党员">中共党员</option>
              </select>
            </div>
          </>
        ) : null}
      </form>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ValidatePage />
  </React.StrictMode>,
);
