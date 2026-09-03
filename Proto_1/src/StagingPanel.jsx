import { useEffect, useState } from 'react';
import { Clipboard, ExternalLink, LoaderCircle, UploadCloud } from 'lucide-react';
import { json, request } from './api.js';

export default function StagingPanel({ site, config, staging, dirty, busy, onBusy, onUpdated }) {
  const [label, setLabel] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const routingLabel = staging?.label || label;
  useEffect(() => { setReviewed(false); }, [site.version, dirty]);
  async function publish() {
    setSending(true); onBusy(true); setError('');
    try {
      await request(`/api/sites/${site.id}/staging`, json({ expectedVersion: site.version, label: routingLabel, reviewConfirmed: reviewed }));
      setReviewed(false); await onUpdated();
    } catch (err) { setError(err.message); }
    finally { setSending(false); onBusy(false); }
  }
  return <section className="panel-section staging-panel">
    <h2>Test deployment</h2>
    <dl className="profile-facts"><dt>Gateway</dt><dd>{config?.stagingOrigin || 'Not connected'}</dd><dt>Access</dt><dd>Password protected</dd><dt>Published release</dt><dd>{staging?.version || '-'}</dd></dl>
    <label className="editor-field">Business subdomain label<input maxLength={80} value={routingLabel} disabled={sending || Boolean(staging)} onChange={(event) => { setLabel(event.target.value); setReviewed(false); }} placeholder="adhil-fashion" /></label>
    <label className="check-field"><input type="checkbox" checked={reviewed} disabled={sending || dirty || busy} onChange={(event) => setReviewed(event.target.checked)} />I reviewed release {site.version} and approve this label and content for a private test.</label>
    <button className="primary full-width" disabled={!config?.stagingConfigured || dirty || busy || sending || !reviewed || routingLabel.trim().length < 2 || site.source === 'demo'} onClick={publish}>{sending ? <LoaderCircle size={17} className="spin" /> : <UploadCloud size={17} />}{sending ? 'Verifying deployment...' : 'Publish test site'}</button>
    {error && <p role="alert" className="message error">{error}</p>}
    {staging?.url && <div className="staging-result"><a className="text-link" href={staging.url} target="_blank" rel="noreferrer">{staging.url}<ExternalLink size={15} /></a><button className="icon-button" title="Copy test site link" aria-label="Copy test site link" onClick={async () => { try { await navigator.clipboard.writeText(staging.url); } catch { setError('Clipboard unavailable. Open the test site to copy its address.'); } }}><Clipboard size={16} /></button></div>}
  </section>;
}
