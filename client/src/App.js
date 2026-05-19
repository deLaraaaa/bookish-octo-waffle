import React, { useState } from 'react';

export default function App() {
  const [file, setFile] = useState(null);
  const [placeholders, setPlaceholders] = useState([]);
  const [id, setId] = useState(null);
  const [values, setValues] = useState({});
  const SERVER = 'http://localhost:4000';

  const upload = async () => {
    if (!file) return alert('Select file first');
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`${SERVER}/upload`, { method: 'POST', body: fd });
    if (!res.ok) {
      const e = await res.json().catch(()=>null);
      return alert('Upload failed: ' + (e && e.error ? e.error : res.status));
    }
    const data = await res.json();
    setId(data.id);
    setPlaceholders(data.placeholders || []);
    const init = {};
    (data.placeholders || []).forEach(p => init[p] = '');
    setValues(init);
  };

  const replaceAndDownload = async () => {
    if (!id) return alert('No upload id');
    const res = await fetch(`${SERVER}/replace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, replacements: values })
    });
    if (!res.ok) {
      const e = await res.json().catch(()=>null);
      return alert('Error generating file: ' + (e && e.error ? e.error : res.status));
    }
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    const cd = res.headers.get('Content-Disposition') || '';
    let filename = 'filled-file';
    const m = /filename="([^"]+)"/.exec(cd);
    if (m) filename = m[1];
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ padding: 20, fontFamily: 'Arial, sans-serif' }}>
      <h3>PDF/DOCX importer with &lt;&lt;var&gt;&gt; placeholders</h3>
      <input type="file" accept=".pdf,.docx" onChange={e => setFile(e.target.files[0])} />
      <button onClick={upload} style={{ marginLeft: 10 }}>Upload & Scan</button>

      {placeholders.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <h4>Fill variables</h4>
          {placeholders.map((p) => (
            <div key={p} style={{ marginBottom: 8 }}>
              <label style={{ width: 150, display: 'inline-block' }}>{p}:</label>
              <input value={values[p] || ''} onChange={e => setValues({ ...values, [p]: e.target.value })} />
            </div>
          ))}
          <button onClick={replaceAndDownload}>Generate & Download</button>
        </div>
      )}
    </div>
  );
}
