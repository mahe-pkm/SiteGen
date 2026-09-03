import { useEffect, useRef, useState } from 'react';
import { FileCode2, LoaderCircle, X } from 'lucide-react';
import { json, request } from './api.js';

export default function ManualDraft({ onClose, onCreated }) {
  const dialog = useRef(null);
  const key = useRef(crypto.randomUUID());
  const [form, setForm] = useState({ name: '', category: '', city: '', description: '', source: 'owner', rightsConfirmed: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { dialog.current.showModal(); }, []);
  async function create(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const { site } = await request('/api/sites', json({ ...form, services: [], template: 'signature', illustrativeImage: false }, 'POST', key.current));
      onCreated(site);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="manual-dialog" onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}><header><h2>Independent business content</h2><button className="icon-button" disabled={busy} title="Close" aria-label="Close" onClick={onClose}><X size={18} /></button></header><form onSubmit={create}>{error && <div className="message error" role="alert">{error}</div>}{[['name', 'Business name', 120], ['category', 'Category', 100], ['city', 'City', 100]].map(([field, label, maxLength]) => <label className="editor-field" key={field}>{label}<input required minLength={2} maxLength={maxLength} value={form[field]} onChange={(e) => setForm((current) => ({ ...current, [field]: e.target.value }))} /></label>)}<label className="editor-field">Description<textarea maxLength={1800} rows={4} value={form.description} onChange={(e) => setForm((current) => ({ ...current, description: e.target.value }))} /></label><label className="editor-field">Source<select value={form.source} onChange={(e) => setForm((current) => ({ ...current, source: e.target.value }))}><option value="owner">Owner supplied</option><option value="licensed">Separately licensed</option></select></label><label className="check-field"><input type="checkbox" required checked={form.rightsConfirmed} onChange={(e) => setForm((current) => ({ ...current, rightsConfirmed: e.target.checked }))} />I have the rights to retain and publish this independently supplied content.</label><button className="primary full-width" disabled={busy || !form.rightsConfirmed}>{busy ? <LoaderCircle size={17} className="spin" /> : <FileCode2 size={17} />}Create preview</button></form></dialog>;
}
