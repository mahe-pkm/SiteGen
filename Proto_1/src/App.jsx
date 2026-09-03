import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, Check, CircleAlert, ExternalLink, FileCode2, Globe, LoaderCircle, MapPin, Plus, RefreshCw, Search, Settings2, ShieldCheck, Sparkles } from 'lucide-react';
import WebsiteEditor from './WebsiteEditor.jsx';
import ManualDraft from './ManualDraft.jsx';
import { activeStates, json, request } from './api.js';

const sample = {
  name: 'Willow Gatherings', brandName: 'Willow Gatherings', brandConfirmed: true,
  category: 'Event planning studio', city: 'Bengaluru',
  description: 'A fictional event studio for intimate weddings, birthday celebrations and corporate gatherings. Consultations are by appointment.',
  services: ['Concept planning', 'Floral styling', 'Venue coordination'], template: 'signature', source: 'demo', rightsConfirmed: true, illustrativeImage: true,
  copy: {
    headline: 'Your people. Your occasion. A celebration that feels like you.', intro: '', heroEvidence: 'Fictional demonstration.',
    aboutTitle: 'First, your story. Then, the details.', about: 'Every proposal starts with the occasion, your date, your guest count, and the venue. Consultations are by appointment, with pricing shared after the conversation.', aboutEvidence: 'Fictional demonstration.',
    services: [
      { title: 'Concept planning', description: 'We discuss your occasion, date, and guest count before shaping a proposal.', evidence: 'Fictional demonstration.' },
      { title: 'Floral styling', description: 'Explore a floral direction that belongs with your event concept and venue.', evidence: 'Fictional demonstration.' },
      { title: 'Venue coordination', description: 'Connect the event plan with the place you have in mind.', evidence: 'Fictional demonstration.' },
    ],
    faqs: [{ question: 'How are consultations arranged?', answer: 'Consultations are by appointment, followed by a proposal and pricing.', evidence: 'Fictional demonstration.' }],
    seoTitle: 'Willow Gatherings | Event Studio', seoDescription: 'Fictional event-studio design demonstration.', seoEvidence: 'Fictional demonstration.',
  },
  briefSource: 'demo', brief: 'Willow Gatherings is a fictional event studio in Bengaluru. It plans intimate weddings, birthday celebrations and corporate gatherings. Services include concept planning, floral styling and venue coordination. Consultations are by appointment. The team discusses the event date, guest count and venue before preparing a proposal. Pricing is provided after consultation.',
};
const statusText = { queued: 'Queued', generating: 'Generating', ready: 'Preview ready', failed: 'Needs attention', published: 'Published', publishing: 'Publishing' };

export default function App() {
  const [config, setConfig] = useState(null);
  const [sites, setSites] = useState([]);
  const [selected, setSelected] = useState(() => new URL(location.href).searchParams.get('site'));
  const [tab, setTab] = useState('websites');
  const [input, setInput] = useState('');
  const [kind, setKind] = useState('auto');
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [names, setNames] = useState({});
  const [manual, setManual] = useState(false);
  const refresh = useCallback(async () => {
    try {
      setSites((await request('/api/sites')).sites);
      setConfig(await request('/api/config'));
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const url = new URL(location.href);
    if (selected) url.searchParams.set('site', selected); else url.searchParams.delete('site');
    history.replaceState(null, '', url);
  }, [selected]);
  useEffect(() => {
    if (!sites.some((site) => activeStates.includes(site.status))) return;
    const timer = setInterval(refresh, 1500);
    return () => clearInterval(timer);
  }, [sites, refresh]);
  async function lookup(event) {
    event.preventDefault(); setBusy(true); setError(''); setResults([]);
    try {
      const result = await request('/api/lookup', json({ input, kind }));
      setResults(result.results);
      if (!result.results.length) setError('No business found. Try the Place ID or business name and city.');
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  async function create(reference) {
    setBusy(true); setError('');
    try {
      const { site } = await request(reference ? '/api/reference-drafts' : '/api/sites', json(reference ? { placeId: reference.placeId } : sample, 'POST', crypto.randomUUID()));
      if (reference) setNames((current) => ({ ...current, [site.id]: reference.name }));
      setSelected(site.id); setResults([]); await refresh();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  if (selected) return <WebsiteEditor key={selected} id={selected} config={config} sessionName={names[selected]} onBack={() => { setSelected(null); refresh(); }} onProfile={(profile) => setNames((current) => current[selected] === profile.name ? current : { ...current, [selected]: profile.name })} onSaved={refresh} />;
  return <div className="studio-shell">
    <aside className="studio-nav"><a className="studio-brand" href="/"><FileCode2 size={25} /><span>Buzl <span className="muted">x</span> Grexa<small>PROTO_1</small></span></a><nav aria-label="Workspace"><button className={tab === 'websites' ? 'active' : ''} onClick={() => setTab('websites')}><Globe size={18} />Websites<span>{sites.length}</span></button><button className={tab === 'connections' ? 'active' : ''} onClick={() => setTab('connections')}><Settings2 size={18} />Connections</button></nav><div className="nav-bottom"><span className="live-dot" />Local development</div></aside>
    <main className="studio-main"><header className="studio-topbar"><span>Workspace / <strong>{tab === 'websites' ? 'Websites' : 'Connections'}</strong></span><span className="local-badge"><ShieldCheck size={15} />Local only</span></header>
      <div className="workspace-body">{error && <div role="alert" className="message error"><CircleAlert size={18} /><span>{error}</span></div>}
        {manual && <ManualDraft onClose={() => setManual(false)} onCreated={(site) => { setManual(false); setSelected(site.id); refresh(); }} />}
        {tab === 'websites' ? <><div className="workspace-heading"><div><span className="eyebrow">Website studio</span><h1>Websites</h1></div><div className="heading-actions"><a className="secondary" href="/design-preview/index.html" target="_blank" rel="noreferrer">Design proposal <ExternalLink size={15} /></a><button className="secondary" disabled={busy} onClick={() => create(null)}>Fictional sample</button><button className="secondary" onClick={() => setManual(true)}><Plus size={16} />Manual draft</button></div></div>
          <form className="intake" onSubmit={lookup}><h2><MapPin size={19} />Google business</h2><div className="intake-fields"><label>Reference<select value={kind} onChange={(e) => setKind(e.target.value)}><option value="auto">Auto detect</option><option value="place-id">Place ID</option><option value="link">Google link</option><option value="name">Name and city</option></select></label><label className="grow">Profile link, Place ID or business name<input required value={input} onChange={(e) => setInput(e.target.value)} placeholder="Google Profile link or ChIJ..." /></label><button className="primary" disabled={busy || !config?.googleConfigured}>{busy ? <LoaderCircle size={17} className="spin" /> : <Search size={17} />}Find business</button></div></form>
          {results.length > 0 && <section className="results" aria-label="Google results">{results.map((result) => <div className="result" key={result.placeId}><MapPin size={20} /><div><h3>{result.name}</h3><p>{result.address}</p><small>{result.category}</small></div><button className="primary" disabled={busy} onClick={() => create(result)}>Create preview<ArrowRight size={16} /></button></div>)}<p className="attribution" translate="no">Google Maps</p></section>}
          <div className="section-heading"><h2>All websites <span className="count">{sites.length}</span></h2><button className="icon-button" title="Refresh websites" aria-label="Refresh websites" onClick={refresh}><RefreshCw size={17} /></button></div>
          {loading ? <div className="loading"><LoaderCircle className="spin" />Loading websites</div> : !sites.length ? <div className="empty-list"><Globe size={32} /><h2>No websites yet</h2></div> : <div className="site-table"><table><thead><tr><th>Business</th><th>Design</th><th>Status</th><th>Release</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{sites.map((site) => <tr key={site.id}><td><button className="site-name" onClick={() => setSelected(site.id)}><span className={`site-monogram ${site.source === 'reference' ? 'google' : ''}`}>{site.source === 'reference' ? <MapPin size={19} /> : site.name[0]}</span><span><strong>{names[site.id] || site.name}</strong><small>{site.source === 'reference' ? site.content.placeId : `${site.city} / ${site.category}`}</small></span></button></td><td className="capitalize">{site.template}</td><td><span className={`state ${site.status}`}>{activeStates.includes(site.status) && <LoaderCircle size={12} className="spin" />}{statusText[site.status]}</span></td><td>{site.version || '-'}</td><td><div className="row-actions">{site.previewUrl && <a className="icon-button" title="Open preview" aria-label="Open preview" href={site.previewUrl} target="_blank" rel="noreferrer"><ExternalLink size={16} /></a>}<button className="icon-button" title="Edit website" aria-label={`Edit ${names[site.id] || site.name}`} onClick={() => setSelected(site.id)}><ArrowRight size={17} /></button></div></td></tr>)}</tbody></table></div>}
        </> : <><div className="workspace-heading"><h1>Connections</h1></div>{[{ name: 'Google Places', icon: MapPin, configured: config?.googleConfigured, facts: [['Credential', config?.googleKeySource || 'Not configured'], ['Requests today', `${config?.lookupsToday || 0} / ${config?.lookupDailyLimit || 100}`], ['Stored reference', 'Place ID only']] }, { name: 'OpenRouter', icon: Sparkles, configured: config?.aiConfigured, facts: [['Writer', config?.writerModel], ['Repair', config?.repairModel], ['Daily cost / reserved', `$${Number(config?.aiSpentToday || 0).toFixed(3)} / $${config?.aiDailyBudget || 5}`]] }, { name: 'Hostinger VPS', icon: Globe, configured: false, facts: [['Deployment', 'Not connected in this local prototype'], ['Meta / WhatsApp', 'Deferred; manual delivery']] }].map(({ name, icon: Icon, configured, facts }) => <section className="connection" key={name}><header><Icon size={23} /><h2>{name}</h2><span className={`state ${configured ? 'ready' : 'queued'}`}>{configured ? <Check size={13} /> : null}{configured ? 'Configured' : 'Not connected'}</span></header><dl>{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || '-'}</dd></div>)}</dl></section>)}</>}
      </div></main>
  </div>;
}
