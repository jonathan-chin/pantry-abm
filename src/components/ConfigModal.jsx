import { useEffect, useState } from 'react';
import { CONFIG_FILES } from '../config.js';

const TOKEN = /("(?:[^"\\]|\\.)*")|(#.*$)|\b([A-Za-z_]\w*)(?=:(?:\s|$))|\b(true|false|null)\b|(-?\b\d+(?:\.\d+)?\b)/g;
const CLASSES = ['cfg-string', 'cfg-comment', 'cfg-key', 'cfg-bool', 'cfg-number'];

function highlight(line, lineNo) {
  const out = [];
  let last = 0;
  let m;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(line))) {
    if (m.index > last) out.push(line.slice(last, m.index));
    const group = m.slice(1).findIndex(g => g !== undefined);
    out.push(<span key={`${lineNo}-${m.index}`} className={CLASSES[group]}>{m[0]}</span>);
    last = m.index + m[0].length;
    if (m[0].length === 0) TOKEN.lastIndex++;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}

export default function ConfigModal({ initial, onClose }) {
  const [which, setWhich] = useState(initial);
  const [copied, setCopied] = useState(false);
  const cfg = CONFIG_FILES.find(f => f.id === which) || CONFIG_FILES[0];
  const text = cfg.text;

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function copy() {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    }).catch(() => {});
  }

  return (
    <div className="summary-overlay" onClick={onClose}>
      <div className="cfg-modal" onClick={e => e.stopPropagation()}>
        <div className="cfg-head">
          <div className="cfg-tabs">
            {CONFIG_FILES.map(f => (
              <button key={f.id} className={'cfg-tab' + (f.id === which ? ' active' : '')} onClick={() => setWhich(f.id)}>
                {f.file}
              </button>
            ))}
          </div>
          <div className="btn-row" style={{ margin: 0 }}>
            <button className="btn" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
            <button className="btn" onClick={onClose}>&times; Close</button>
          </div>
        </div>
        <div className="cfg-note">
          config/{cfg.file} — these are the starting values. Edit the file and the app reloads. Sliders change the live run, not the file.
        </div>
        <pre className="cfg-code">
          {text.split('\n').map((line, i) => (
            <div key={i} className="cfg-line">
              <span className="cfg-ln">{i + 1}</span>
              <span>{highlight(line, i)}</span>
            </div>
          ))}
        </pre>
      </div>
    </div>
  );
}
