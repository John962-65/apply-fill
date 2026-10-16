import React, { useId, useState } from 'react';
import ReactDOM from 'react-dom/client';

function Uploader() {
  const inputId = useId();
  const [fileName, setFileName] = useState('');

  return (
    <div style={{ maxWidth: 560 }}>
      <h1>附件上传</h1>
      <form id="upload-form">
        <div style={{ border: '1px dashed #999', borderRadius: 8, padding: 16 }}>
          <label htmlFor={inputId}>简历附件（PDF）</label>
          <input
            id={inputId}
            name="resumeFile"
            type="file"
            accept=".pdf,application/pdf"
            style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }}
            onChange={(event) => {
              const file = event.target.files?.[0];
              setFileName(file === undefined ? '' : file.name);
            }}
            data-testid="upload-input"
          />
          <div data-testid="upload-status" data-file-accepted={fileName !== '' ? 'true' : 'false'}>
            {fileName === '' ? '尚未选择文件' : `已选择：${fileName}`}
          </div>
        </div>
      </form>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <Uploader />
  </React.StrictMode>,
);
