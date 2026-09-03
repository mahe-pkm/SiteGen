import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, CircleAlert, Clipboard, ExternalLink, FileText, ImagePlus, LoaderCircle, Monitor, Palette, Plus, RefreshCw, Save, ShieldCheck, Smartphone, Sparkles, Trash2, X } from 'lucide-react';
import { activeStates, json, normalizeContent, request } from './api.js';
import StagingPanel from './StagingPanel.jsx';

const copyGroups = [
  { id: 'hero', label: 'Introduction', fields: ['headline', 'intro', 'heroEvidence'] },
  { id: 'about', label: 'About', fields: ['aboutTitle', 'about', 'aboutEvidence'] },
  { id: 'services', label: 'Services', fields: ['services'] },
  { id: 'faqs', label: 'FAQs', fields: ['faqs'] },
  { id: 'seo', label: 'Search metadata', fields: ['seoTitle', 'seoDescription', 'seoEvidence'] },
];
function Field({ label, value = '', onChange, area, ...props }) {
  return <label className="editor-field">{label}{area ? <textarea rows={3} value={value} onChange={(e) => onChange(e.target.value)} {...props} /> : <input value={value} onChange={(e) => onChange(e.target.value)} {...props} />}</label>;
}
function IconButton({ label, children, ...props }) {
  return <button type="button" className="icon-button" title={label} aria-label={label} {...props}>{children}</button>;
}

export default function WebsiteEditor({ id, config, sessionName, onBack, onProfile, onSaved }) {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [saved, setSaved] = useState('');
  const [baseVersion, setBaseVersion] = useState(0);
  const [tab, setTab] = useState('content');
  const [viewport, setViewport] = useState('desktop');
  const [reload, setReload] = useState(0);
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [writing, setWriting] = useState(false);
  const [candidate, setCandidate] = useState(null);
  const [checks, setChecks] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const iframe = useRef(null);
  const initialized = useRef(false);
  const pendingSave = useRef(false);
  const aiRequest = useRef(null);
  const dirty = form && JSON.stringify(form) !== saved;
  const load = useCallback(async () => {
    try {
      const result = await request(`/api/sites/${id}`);
      setData(result);
      if (!initialized.current) {
        const content = normalizeContent(result.site.content);
        setForm(content); setSaved(JSON.stringify(content)); setBaseVersion(result.site.version); initialized.current = true;
        pendingSave.current = activeStates.includes(result.site.status);
      }
      if (pendingSave.current && !activeStates.includes(result.site.status)) {
        setBaseVersion(result.site.version); pendingSave.current = false;
        setNotice(result.site.status === 'failed' ? '' : `Preview ready. Release ${result.site.version}.`);
      }
    } catch (err) { setError(err.message); }
  }, [id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!data || (!activeStates.includes(data.site.status) && !data.stagingBusy)) return;
    const timer = setInterval(load, 1200);
    return () => clearInterval(timer);
  }, [data, load]);
  useEffect(() => {
    function receive(event) {
      if (event.origin !== location.origin || event.source !== iframe.current?.contentWindow || event.data?.type !== 'proto:profile' || event.data.siteId !== id) return;
      setProfile(event.data.profile); onProfile(event.data.profile);
    }
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [id, onProfile]);
  useEffect(() => {
    const guard = (event) => { if (dirty || writing || saving || deploying) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty, writing, saving, deploying]);
  function change(key, value) { setForm((current) => ({ ...current, [key]: value })); setNotice(''); }
  function copyChange(key, value) { setForm((current) => ({ ...current, copy: { ...current.copy, [key]: value } })); setNotice(''); }
  function updateList(key, index, field, value) {
    copyChange(key, form.copy[key].map((item, i) => i === index ? { ...item, [field]: value } : item));
  }
  async function save() {
    setSaving(true); setError(''); setNotice('');
    try {
      const result = await request(`/api/sites/${id}`, json({ content: form, expectedVersion: baseVersion }, 'PATCH'));
      const content = normalizeContent(result.site.content);
      setForm(content); setSaved(JSON.stringify(content)); pendingSave.current = true;
      setData((current) => ({ ...current, site: result.site })); setNotice('Saved. Generating a new preview release.'); onSaved();
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  }
  async function write() {
    setWriting(true); setError(''); setNotice('');
    const input = { brief: form.brief, source: form.briefSource, permissionConfirmed: form.briefConfirmed };
    const fingerprint = JSON.stringify(input);
    if (!aiRequest.current || aiRequest.current.fingerprint !== fingerprint || aiRequest.current.completed) aiRequest.current = { key: crypto.randomUUID(), fingerprint };
    try {
      const result = await request(`/api/sites/${id}/ai`, json(input, 'POST', aiRequest.current.key));
      setCandidate(result); aiRequest.current.completed = true; onSaved();
    } catch (err) {
      setError(err.message);
      // Server failures explicitly permit a fresh attempt; uncertain network failures reuse the key.
      if (!/fetch|network/i.test(err.message)) aiRequest.current.completed = true;
    } finally { setWriting(false); load(); }
  }
  function apply(group, replace = false) {
    const fields = group.fields;
    const populated = fields.filter((field) => !field.endsWith('Evidence')).some((field) => form.copy[field]?.length);
    if (populated && !replace && !window.confirm(`Replace your current ${group.label.toLowerCase()} copy with this AI draft?`)) return;
    setForm((current) => ({ ...current, copy: { ...current.copy, ...Object.fromEntries(fields.map((field) => [field, candidate.copy[field]])) } }));
    setNotice(`${group.label} applied to the editor. Review and save to update the preview.`);
  }
  function applyMissing() {
    setForm((current) => {
      const copy = { ...current.copy };
      for (const group of copyGroups) {
        if (!group.fields.filter((field) => !field.endsWith('Evidence')).some((field) => copy[field]?.length)) {
          for (const field of group.fields) copy[field] = candidate.copy[field];
        }
      }
      return { ...current, copy };
    });
    setNotice('Missing sections applied. Existing copy was preserved. Review and save.');
  }
  function runChecks() {
    const frame = iframe.current;
    if (!frame?.contentDocument) return;
    const doc = frame.contentDocument;
    const runtime = frame.contentWindow.__protoChecks?.();
    setChecks({ ...runtime, width: frame.clientWidth, html: Boolean(doc.querySelector('main')), title: Boolean(doc.title), contact: Boolean(doc.querySelector('#contact')), measured: new Date().toLocaleTimeString() });
  }
  async function upload(event, onReady = (id) => change('imageId', id)) {
    const file = event.target.files?.[0]; if (!file) return;
    setUploading(true); setError('');
    try {
      const body = new FormData(); body.append('image', file);
      const result = await request('/api/assets', { method: 'POST', body });
      onReady(result.id, file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '));
    } catch (err) { setError(err.message); }
    finally { setUploading(false); event.target.value = ''; }
  }
  function addGalleryImage(id, name) {
    setForm((current) => ({
      ...current,
      gallery: [...current.gallery, { imageId: id, caption: name.trim().length > 1 ? name.trim().slice(0, 100) : 'Event photograph', category: 'celebrations' }],
      mediaConfirmed: current.source === 'reference' ? false : current.mediaConfirmed,
    }));
    setNotice('');
  }
  function back() {
    if (writing || saving || deploying) { setError('Wait for the active request before leaving this website.'); return; }
    if (dirty && !window.confirm('Leave without saving your edits?')) return;
    onBack();
  }
  if (!data || !form) return <div className="loading"><LoaderCircle className="spin" />{error || 'Loading website'}<button className="secondary" onClick={onBack}>Back</button></div>;
  const { site } = data;
  const busy = activeStates.includes(site.status) || deploying || data.stagingBusy;
  const reference = form.source === 'reference';
  const name = profile?.name || sessionName || site.name;
  return <div className="editor-shell">
    <header className="editor-header"><IconButton label="Back to websites" onClick={back}><ArrowLeft size={20} /></IconButton><div className="editor-title"><h1>{name}</h1><small>{reference ? 'Live Google reference' : form.source === 'demo' ? 'Fictional demonstration' : 'Independent business content'} <span>/</span> Release {site.version || '-'}</small></div><div className="editor-header-actions">{dirty && <span className="unsaved">Unsaved</span>}<button className="primary" disabled={saving || busy || uploading || !dirty} onClick={save}>{saving || busy ? <LoaderCircle size={16} className="spin" /> : <Save size={16} />}{busy ? 'Generating' : 'Save preview'}</button></div></header>
    {(error || site.error) && <div role="alert" className="message error"><CircleAlert size={17} /><span>{error || site.error}</span><IconButton label="Dismiss error" onClick={() => setError('')}><X size={15} /></IconButton></div>}
    {notice && <div role="status" className="message success"><Check size={16} /><span>{notice}</span></div>}
    <div className="editor-body"><section className="preview-workspace"><div className="preview-toolbar"><div className="segmented" aria-label="Preview size"><IconButton label="Desktop preview" aria-pressed={viewport === 'desktop'} onClick={() => { setViewport('desktop'); setChecks(null); }}><Monitor size={17} /></IconButton><IconButton label="Mobile preview" aria-pressed={viewport === 'mobile'} onClick={() => { setViewport('mobile'); setChecks(null); }}><Smartphone size={17} /></IconButton></div><span className="preview-status">{busy ? 'Generating' : site.version ? 'Local preview' : 'Pending'}</span><div className="row-actions"><IconButton label="Reload preview" disabled={!site.previewUrl} onClick={() => { setReload((value) => value + 1); setProfile(null); setChecks(null); }}><RefreshCw size={16} /></IconButton><IconButton label="Copy local preview link" disabled={!site.previewUrl} onClick={async () => { try { await navigator.clipboard.writeText(new URL(site.previewUrl, location.origin).href); setNotice('Local preview link copied. Available on this computer only.'); } catch { setError('Clipboard unavailable. Open the preview to copy its address.'); } }}><Clipboard size={16} /></IconButton>{site.previewUrl && <a className="icon-button" href={site.previewUrl} target="_blank" rel="noreferrer" title="Open preview" aria-label="Open preview"><ExternalLink size={16} /></a>}</div></div><div className={`preview-stage ${viewport}`}>
      {site.previewUrl ? <iframe ref={iframe} key={`${site.version}-${reload}`} title="Website preview" src={site.previewUrl} onLoad={() => setChecks(null)} /> : <div className="loading"><LoaderCircle className="spin" />Generating website</div>}
    </div></section>
    <aside className="editor-panel"><nav className="editor-tabs" aria-label="Website editor">{[{ id: 'content', label: 'Content', icon: FileText }, { id: 'ai', label: 'AI writer', icon: Sparkles }, { id: 'design', label: 'Design', icon: Palette }, { id: 'checks', label: 'Checks', icon: ShieldCheck }].map(({ id: key, label, icon: Icon }) => <button key={key} aria-pressed={tab === key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}><Icon size={17} />{label}</button>)}</nav><div className="panel-body">
      {tab === 'design' && form.liveGoogle && <section className="panel-section"><h2>Google hero photo</h2><div className="photo-choices">{(profile?.photos || []).map((photo, index) => <figure key={index}><button type="button" title={`Use Google photograph ${index + 1} as hero`} aria-label={`Use Google photograph ${index + 1} as hero`} aria-pressed={form.googleHeroIndex === index} onClick={() => change('googleHeroIndex', index)}><img src={photo.url} alt={`Google profile photograph ${index + 1}`} />{form.googleHeroIndex === index && <span><Check size={15} /></span>}</button><figcaption><span>Google Maps</span>{photo.authors.map((author, i) => <a key={i} href={author.uri || photo.source} target="_blank" rel="noreferrer">{author.name}</a>)}</figcaption></figure>)}</div></section>}
      {tab === 'design' && reference && form.template !== 'signature' && form.imageId && <label className="check-field"><input type="checkbox" checked={form.mediaConfirmed} onChange={(event) => change('mediaConfirmed', event.target.checked)} />The uploaded hero is independently supplied and licensed, not copied from Google API results.</label>}
      {tab === 'content' && <>
        {form.liveGoogle && <section className="panel-section"><h2><span className="live-dot" />Google profile</h2><dl className="profile-facts"><dt>Name</dt><dd>{profile?.name || 'Loading live profile'}</dd><dt>Contact</dt><dd>{profile?.phone || '-'}</dd><dt>Address</dt><dd>{profile?.address || '-'}</dd><dt>Photos / reviews</dt><dd>{profile ? `${profile.photoCount} / ${profile.reviewCount}` : '-'}</dd></dl><small className="attribution">Google Maps / live display</small></section>}
        {!reference && <details className="edit-details"><summary>Business details</summary><Field label="Business name" value={form.name} onChange={(v) => change('name', v)} maxLength={120} /><Field label="Category" value={form.category} onChange={(v) => change('category', v)} /><Field label="City" value={form.city} onChange={(v) => change('city', v)} /><Field label="Address" value={form.address} onChange={(v) => change('address', v)} /><Field label="Phone" value={form.phone} onChange={(v) => change('phone', v)} /><Field label="WhatsApp" value={form.whatsapp} onChange={(v) => change('whatsapp', v)} placeholder="+91..." /><Field label="Email" value={form.email} onChange={(v) => change('email', v)} /><Field label="Description" area value={form.description} onChange={(v) => change('description', v)} /><Field label="Service names (one per line)" area value={form.services.join('\n')} onChange={(v) => change('services', v.split('\n'))} /><Field label="Business hours" area value={form.hours} onChange={(v) => change('hours', v)} /></details>}
        {!['events', 'signature'].includes(form.template) && <div className="message warning">Detailed section copy requires the Events or Signature design.</div>}
        <section className="panel-section"><h2>Introduction</h2><Field label="Headline" value={form.copy.headline} onChange={(v) => copyChange('headline', v)} maxLength={150} /><Field label="Introduction" area value={form.copy.intro} onChange={(v) => copyChange('intro', v)} maxLength={500} /></section>
        <section className="panel-section"><h2>About</h2><Field label="Section title" value={form.copy.aboutTitle} onChange={(v) => copyChange('aboutTitle', v)} maxLength={120} /><Field label="About the business" area value={form.copy.about} onChange={(v) => copyChange('about', v)} maxLength={1600} /></section>
        {['services', 'faqs'].map((key) => <section className="panel-section" key={key}><div className="section-heading"><h2>{key === 'services' ? 'Services' : 'FAQs'}</h2><IconButton label={`Add ${key === 'services' ? 'service' : 'FAQ'}`} disabled={form.copy[key].length >= (key === 'services' ? 8 : 6)} onClick={() => copyChange(key, [...form.copy[key], key === 'services' ? { title: '', description: '', evidence: 'Manually supplied copy' } : { question: '', answer: '', evidence: 'Manually supplied copy' }])}><Plus size={16} /></IconButton></div>{form.copy[key].map((item, index) => <div className="copy-item" key={index}><div className="copy-item-header"><span>{index + 1}</span><IconButton label={`Remove ${key === 'services' ? 'service' : 'FAQ'} ${index + 1}`} onClick={() => copyChange(key, form.copy[key].filter((_, i) => i !== index))}><Trash2 size={14} /></IconButton></div>{(key === 'services' ? [['title', 'Service'], ['description', 'Description']] : [['question', 'Question'], ['answer', 'Answer']]).map(([field, label], i) => <Field key={field} label={label} area={Boolean(i)} value={item[field]} onChange={(v) => updateList(key, index, field, v)} maxLength={i ? 600 : key === 'services' ? 100 : 200} />)}</div>)}</section>)}
        <details className="edit-details"><summary>Search metadata</summary><Field label="Page title" value={form.copy.seoTitle} onChange={(v) => copyChange('seoTitle', v)} maxLength={160} /><Field label="Meta description" area value={form.copy.seoDescription} onChange={(v) => copyChange('seoDescription', v)} maxLength={300} /></details>
      </>}
      {tab === 'ai' && <><section className="panel-section"><h2>Source brief</h2><label className="editor-field">Content source<select value={form.briefSource} disabled={writing} onChange={(e) => { change('briefSource', e.target.value); change('briefConfirmed', false); }}><option value="owner">Owner supplied</option><option value="licensed">Separately licensed</option><option value="demo">Fictional demonstration</option></select></label><Field label="Business facts and services" area rows={10} value={form.brief} disabled={writing} onChange={(v) => { change('brief', v); change('briefConfirmed', false); }} maxLength={8000} /><small className="muted">{form.brief.length} / 8,000 characters</small><label className="check-field"><input type="checkbox" checked={form.briefConfirmed} disabled={writing} onChange={(e) => change('briefConfirmed', e.target.checked)} />I may send this independent content to the AI provider. It is not copied from Google API results.</label><button className="primary full-width" disabled={writing || !config?.aiConfigured || form.brief.trim().length < 40 || !form.briefConfirmed} onClick={write}>{writing ? <LoaderCircle size={17} className="spin" /> : <Sparkles size={17} />}{writing ? 'Writing and checking...' : 'Generate copy'}</button>{!config?.aiConfigured && <div className="message warning">OpenRouter key is not configured.</div>}<dl className="ai-facts"><dt>Writer</dt><dd>{config?.writerModel || '-'}</dd><dt>Maximum repairs</dt><dd>2</dd><dt>Daily budget</dt><dd>${config?.aiDailyBudget || 5}</dd></dl></section>
        {candidate && <section className="panel-section"><div className="section-heading"><h2>Draft for review</h2><span className="state ready">Checked</span></div><p className="review-note">{candidate.review}</p><button className="secondary full-width" onClick={applyMissing}><Plus size={16} />Apply missing sections</button>{copyGroups.map((group) => <details className="candidate-section" key={group.id} open={group.id === 'hero'}><summary>{group.label}</summary>{group.fields.filter((field) => !field.endsWith('Evidence')).map((field) => Array.isArray(candidate.copy[field]) ? candidate.copy[field].map((item, index) => <div key={index}><strong>{item.title || item.question}</strong><p>{item.description || item.answer}</p><small className="evidence">Source: {item.evidence}</small></div>) : <p key={field}>{candidate.copy[field]}</p>)}{group.fields.filter((field) => field.endsWith('Evidence') && candidate.copy[field]).map((field) => <small className="evidence" key={field}>Source: {candidate.copy[field]}</small>)}<button className="secondary" onClick={() => apply(group)}><Check size={14} />Apply {group.label.toLowerCase()}</button></details>)}<small className="muted">{candidate.model} / {candidate.attempts} attempt(s) / {candidate.cost === null ? 'Cost pending' : `$${candidate.cost.toFixed(4)}`}</small></section>}
      </>}
      {tab === 'design' && <><section className="panel-section"><h2>Template</h2><label className="editor-field">Design<select value={form.template} onChange={(e) => change('template', e.target.value)}><option value="signature">Signature</option><option value="events">Events (original)</option>{!reference && <><option value="atelier">Atelier (original)</option><option value="local">Local (original)</option></>}</select></label><div className="design-image"><img src={form.template === 'signature' ? '/design-preview/assets/hero.webp' : '/assets/illustrative-interior.webp'} alt="Illustrative template preview" /><span>{form.template === 'signature' ? 'Signature design' : 'Illustrative design image'}</span></div></section>
        {form.template === 'signature' && <section className="panel-section"><h2>Brand</h2><Field label="Short brand name (optional)" value={form.brandName} onChange={(value) => { change('brandName', value); if (reference) change('brandConfirmed', false); }} maxLength={80} />{form.logoId && <img className="uploaded-logo" src={`/api/assets/${form.logoId}`} alt="Uploaded logo" />}<label className="upload-control"><ImagePlus size={18} />{uploading ? 'Uploading...' : 'Upload logo'}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading} onChange={(event) => upload(event, (id) => { change('logoId', id); if (reference) change('brandConfirmed', false); })} /></label>{form.logoId && <button className="secondary" onClick={() => { change('logoId', ''); if (reference) change('brandConfirmed', false); }}><Trash2 size={15} />Remove logo</button>}{reference && <label className="check-field"><input type="checkbox" checked={form.brandConfirmed} onChange={(event) => change('brandConfirmed', event.target.checked)} />This brand name and logo were supplied independently and were not copied from Google API results.</label>}</section>}
        <section className="panel-section"><h2>Palette</h2><div className="swatches">{['forest', 'rose', 'ink'].map((palette) => <button className={`swatch ${palette}`} key={palette} aria-label={`${palette} palette`} title={`${palette} palette`} aria-pressed={form.palette === palette} onClick={() => change('palette', palette)}>{form.palette === palette && <Check size={19} />}</button>)}</div><h2 className="spaced">Typography</h2><div className="segmented text-segmented">{['editorial', 'modern'].map((layout) => <button key={layout} aria-pressed={form.layout === layout} onClick={() => change('layout', layout)}>{layout}</button>)}</div></section>
        <section className="panel-section"><h2>Hero image</h2>{form.imageId && <img className="uploaded-image" src={`/api/assets/${form.imageId}`} alt="Uploaded hero" />}<label className="upload-control"><ImagePlus size={18} />{uploading ? 'Uploading...' : 'Upload owned image'}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading} onChange={(event) => upload(event, (id) => { change('imageId', id); if (reference) change('mediaConfirmed', false); })} /></label>{form.imageId && <button className="secondary" onClick={() => { change('imageId', ''); if (reference) change('mediaConfirmed', false); }}><Trash2 size={15} />Remove image</button>}{!reference && <label className="check-field"><input type="checkbox" checked={form.illustrativeImage} onChange={(e) => change('illustrativeImage', e.target.checked)} />Use the clearly labelled illustrative image when no owned image is available</label>}</section>
        {form.template === 'signature' && <section className="panel-section"><div className="section-heading"><h2>Owned gallery</h2><span className="state">{form.gallery.length} / 9</span></div>{form.gallery.map((image, index) => <div className="gallery-editor-item" key={image.imageId}><img src={`/api/assets/${image.imageId}`} alt="" /><Field label="Caption" value={image.caption} maxLength={100} onChange={(value) => change('gallery', form.gallery.map((item, i) => i === index ? { ...item, caption: value } : item))} /><label className="editor-field">Category<select value={image.category} onChange={(event) => change('gallery', form.gallery.map((item, i) => i === index ? { ...item, category: event.target.value } : item))}><option value="celebrations">Celebrations</option><option value="styling">Styling</option><option value="venues">Venues</option></select></label><IconButton label={`Remove gallery photograph ${index + 1}`} onClick={() => { change('gallery', form.gallery.filter((_, i) => i !== index)); if (reference) change('mediaConfirmed', false); }}><Trash2 size={15} /></IconButton></div>)}<label className="upload-control"><ImagePlus size={18} />{uploading ? 'Uploading...' : 'Add gallery photograph'}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading || form.gallery.length >= 9} onChange={(event) => upload(event, addGalleryImage)} /></label>{reference && (form.imageId || form.gallery.length > 0) && <label className="check-field"><input type="checkbox" checked={form.mediaConfirmed} onChange={(event) => change('mediaConfirmed', event.target.checked)} />These uploaded photographs are independently supplied and licensed; they are not copied from Google API results.</label>}</section>}
      </>}
      {tab === 'checks' && <><section className="panel-section"><h2>Preview checks</h2><button className="secondary full-width" disabled={!site.previewUrl} onClick={runChecks}><ShieldCheck size={16} />Check current viewport</button>{checks && <><small className="muted">{checks.width}px / {checks.measured}</small><ul className="checks-list">{[['HTML loaded', checks.html], ['Page title', checks.title], ['Contact section', checks.contact], ['No horizontal overflow', checks.overflow === false], ['Internal links', checks.brokenAnchors?.length === 0], ['Loaded images', checks.brokenImages?.length === 0], ...(form.liveGoogle ? [['Google profile loaded', checks.loadedGoogle === true]] : [])].map(([label, pass]) => <li key={label}>{pass ? <Check size={17} /> : <CircleAlert size={17} />}<span>{label}</span><strong>{pass ? 'Pass' : 'Review'}</strong></li>)}</ul></>}</section><StagingPanel site={site} config={config} staging={data.staging} dirty={dirty} busy={busy} onBusy={setDeploying} onUpdated={load} /><section className="panel-section"><h2>Activity</h2><ol className="activity">{data.events.map((event, i) => <li key={`${event.createdAt}-${i}`}><p>{event.message}</p><time>{new Date(event.createdAt).toLocaleTimeString()}</time></li>)}</ol></section>{site.status === 'failed' && <button className="secondary" onClick={async () => { try { await request(`/api/sites/${id}/generate`, json({})); pendingSave.current = true; await load(); } catch (err) { setError(err.message); } }}><RefreshCw size={16} />Retry generation</button>}</>}
    </div></aside></div>
  </div>;
}
