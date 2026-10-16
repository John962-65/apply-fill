import React, { useId, useState } from 'react';
import ReactDOM from 'react-dom/client';

function StrictUploader() {
  const inputId = useId();
  const [fileName, setFileName] = useState('');
  const [notice, setNotice] = useState('');

  return (
    <div style={{ maxWidth: 560 }}>
      <h1>附件上传（严格校验）</h1>
      <form id="upload-form-strict">
        <div style={{ border: '1px dashed #999', borderRadius: 8, padding: 16 }}>
          <label htmlFor={inputId}>简历附件（PDF）</label>
          <input
            id={inputId}
            name="resumeFileStrict"
            type="file"
            accept=".pdf,application/pdf"
            style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }}
            onChange={(event) => {
              if (!event.nativeEvent.isTrusted) {
                event.currentTarget.value = '';
                setFileName('');
                setNotice('已拒绝程序化上传，请人工选择文件');
                return;
              }
              const file = event.target.files?.[0];
              setFileName(file === undefined ? '' : file.name);
              setNotice('');
            }}
            data-testid="upload-input-strict"
          />
          <div data-testid="upload-status-strict" data-file-accepted={fileName !== '' ? 'true' : 'false'}>
            {fileName === '' ? '尚未选择文件' : `已选择：${fileName}`}
          </div>
          <div data-testid="upload-notice-strict">{notice}</div>
        </div>
      </form>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <StrictUploader />
  </React.StrictMode>,
);
