import { useState } from 'react'
import Papa from 'papaparse'
import { api } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { Pill } from '../components/ui'

export default function Discover() {
  const [tab, setTab] = useState('places')
  const { org, refreshOrg, supportView } = useAuth()
  const creditsLeft = org ? Math.max(0, org.monthly_credits - org.credits_used) : 0

  if (supportView) {
    return (
      <div className="section" style={{ textAlign: 'center', padding: 40 }}>
        <h3>Read-only in support view</h3>
        <p className="muted" style={{ marginTop: 8 }}>Discovery spends this customer's credits, so it's disabled while impersonating. Their credit balance: {creditsLeft}.</p>
      </div>
    )
  }

  return (
    <div>
      <div className="row-between">
        <h1>Discover</h1>
        <span className="muted mono">{creditsLeft} credits left this period</span>
      </div>
      <p className="muted">Every adapter lands leads in the same pipeline. Imports are free; discovered leads cost 1 credit each when you save them.</p>
      <div style={{ display: 'flex', gap: 8, margin: '14px 0', flexWrap: 'wrap' }}>
        <Tab id="places" tab={tab} setTab={setTab}>Local businesses</Tab>
        <Tab id="web" tab={tab} setTab={setTab}>Website prospector</Tab>
        <Tab id="csv" tab={tab} setTab={setTab}>Import CSV</Tab>
      </div>
      {tab === 'places' && <PlacesTab onSaved={refreshOrg} />}
      {tab === 'web' && <WebTab onSaved={refreshOrg} />}
      {tab === 'csv' && <CsvTab />}
    </div>
  )
}

const Tab = ({ id, tab, setTab, children }) => (
  <button className={`btn small ${tab === id ? 'primary' : 'ghost'}`} onClick={() => setTab(id)}>{children}</button>
)

function CandidateTable({ candidates, checked, setChecked, cols }) {
  const toggleAll = () => setChecked(checked.size === candidates.length ? new Set() : new Set(candidates.map((_, i) => i)))
  return (
    <div className="tablewrap"><table className="plain" style={{ marginTop: 12 }}>
      <thead>
        <tr>
          <th style={{ width: 30 }}><input type="checkbox" style={{ width: 'auto' }} checked={checked.size === candidates.length && candidates.length > 0} onChange={toggleAll} /></th>
          {cols.map((c) => <th key={c.k}>{c.h}</th>)}
        </tr>
      </thead>
      <tbody>
        {candidates.map((c, i) => (
          <tr key={i} className="clickable" onClick={() => {
            const next = new Set(checked); next.has(i) ? next.delete(i) : next.add(i); setChecked(next)
          }}>
            <td><input type="checkbox" style={{ width: 'auto' }} checked={checked.has(i)} readOnly /></td>
            {cols.map((col) => <td key={col.k} className={col.muted ? 'muted' : ''}>{col.r ? col.r(c) : (c[col.k] || '—')}</td>)}
          </tr>
        ))}
      </tbody>
    </table></div>
  )
}

function SaveBar({ candidates, checked, adapter, criteria, onSaved, free }) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const save = async () => {
    setBusy(true); setResult(null)
    try {
      const selected = [...checked].map((i) => candidates[i])
      const r = await api('save-leads', { method: 'POST', body: { candidates: selected, adapter, criteria } })
      setResult({ ok: true, text: `Saved ${r.saved} lead${r.saved === 1 ? '' : 's'}${r.skipped ? ` · ${r.skipped} already in your pipeline` : ''}${r.credits_spent ? ` · ${r.credits_spent} credits used` : ''}. Enrichment is running in the background.` })
      onSaved?.()
    } catch (e) { setResult({ ok: false, text: e.message }) }
    setBusy(false)
  }
  return (
    <div style={{ marginTop: 12 }}>
      {result && <div className={`banner ${result.ok ? 'ok' : 'err'}`}>{result.text}</div>}
      <button className="btn primary" disabled={busy || checked.size === 0} onClick={save}>
        Save {checked.size} selected {free ? '(free)' : `(${checked.size} credit${checked.size === 1 ? '' : 's'})`}
      </button>
    </div>
  )
}

function PlacesTab({ onSaved }) {
  const [query, setQuery] = useState('')
  const [location, setLocation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [candidates, setCandidates] = useState(null)
  const [checked, setChecked] = useState(new Set())

  const run = async () => {
    setBusy(true); setError(null); setCandidates(null)
    try {
      const r = await api('discover-places', { method: 'POST', body: { query, location } })
      setCandidates(r.candidates); setChecked(new Set(r.candidates.map((_, i) => i)))
    } catch (e) { setError(e.message) }
    setBusy(false)
  }

  return (
    <div className="section">
      <h2>Local businesses</h2>
      <p className="muted">Search real businesses by what they do and where they are. Great for any location-bound vertical — dental, legal, home services, fitness.</p>
      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: '2fr 2fr auto', alignItems: 'end' }}>
        <label>What are you looking for?<input placeholder="med spas" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
        <label>Where?<input placeholder="Chicago, IL" value={location} onChange={(e) => setLocation(e.target.value)} /></label>
        <button className="btn primary" disabled={busy || !query} onClick={run}>{busy ? 'Searching…' : 'Search'}</button>
      </div>
      {error && <div className="banner err" style={{ marginTop: 12 }}>{error}</div>}
      {candidates && (candidates.length === 0
        ? <p className="muted" style={{ marginTop: 12 }}>Nothing found — try a broader search.</p>
        : <>
          <CandidateTable candidates={candidates} checked={checked} setChecked={setChecked} cols={[
            { k: 'company', h: 'Business' },
            { k: 'city', h: 'City', muted: true },
            { k: 'website', h: 'Website', muted: true, r: (c) => c.website ? c.website.replace(/^https?:\/\//, '').slice(0, 34) : '—' },
            { k: 'phone', h: 'Phone', muted: true },
            { k: 'rating', h: 'Rating', muted: true, r: (c) => c.rating ? `${c.rating}★ (${c.review_count})` : '—' },
          ]} />
          <SaveBar candidates={candidates} checked={checked} adapter="places" criteria={{ query, location }} onSaved={onSaved} />
        </>)}
    </div>
  )
}

function WebTab({ onSaved }) {
  const [domains, setDomains] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [candidates, setCandidates] = useState(null)
  const [checked, setChecked] = useState(new Set())

  const run = async () => {
    setBusy(true); setError(null); setCandidates(null)
    try {
      const r = await api('discover-web', { method: 'POST', body: { domains: domains.split(/[\n,\s]+/).filter(Boolean) } })
      setCandidates(r.candidates); setChecked(new Set(r.candidates.map((_, i) => i)))
    } catch (e) { setError(e.message) }
    setBusy(false)
  }

  return (
    <div className="section">
      <h2>Website prospector</h2>
      <p className="muted">Paste up to 15 websites — any vertical, anywhere. Each one gets fingerprinted: contact email, socials, tech stack, and the signals worth mentioning in your first line.</p>
      <textarea placeholder={'acmedental.com\nnorthsidelaw.com\nbrightfitstudio.com'} value={domains} onChange={(e) => setDomains(e.target.value)} />
      {error && <div className="banner err" style={{ marginTop: 10 }}>{error}</div>}
      <div style={{ marginTop: 10 }}>
        <button className="btn primary" disabled={busy || !domains.trim()} onClick={run}>{busy ? 'Analyzing sites…' : 'Analyze'}</button>
      </div>
      {candidates && <>
        <CandidateTable candidates={candidates} checked={checked} setChecked={setChecked} cols={[
          { k: 'company', h: 'Company' },
          { k: 'email', h: 'Email found', muted: true },
          { k: 'linkedin_url', h: 'LinkedIn', muted: true, r: (c) => c.linkedin_url ? 'found' : '—' },
          { k: 'error', h: 'Notes', muted: true, r: (c) => c.error ? `couldn't reach: ${c.error}` : (c._enrichment?.signals?.headline || '').slice(0, 44) },
        ]} />
        <SaveBar candidates={candidates} checked={checked} adapter="web" criteria={{ domains: domains.split(/[\n,\s]+/).filter(Boolean).length }} onSaved={onSaved} />
      </>}
    </div>
  )
}

function CsvTab() {
  const [rows, setRows] = useState(null)
  const [attest, setAttest] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  const onFile = (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    Papa.parse(f, {
      header: true, skipEmptyLines: true,
      transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, '_'),
      complete: (res) => setRows(res.data),
    })
  }

  const doImport = async () => {
    setBusy(true); setResult(null)
    try {
      const r = await api('import-leads', { method: 'POST', body: { rows, attest_consent: attest } })
      setResult({ ok: true, text: `Imported ${r.saved}${r.skipped ? ` · ${r.skipped} duplicates skipped` : ''}.` })
      setRows(null)
    } catch (e) { setResult({ ok: false, text: e.message }) }
    setBusy(false)
  }

  return (
    <div className="section">
      <h2>Import CSV</h2>
      <p className="muted">
        The universal fallback — any vertical, any list you already own. Recognized columns:
        {' '}<span className="mono">name, email, company, title, website, phone, city, region, country, linkedin_url</span>. Free, no credits.
      </p>
      <input type="file" accept=".csv" onChange={onFile} />
      {rows && (
        <div style={{ marginTop: 12 }}>
          <p className="muted">{rows.length} rows parsed. First row: <span className="mono">{JSON.stringify(rows[0]).slice(0, 120)}…</span></p>
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', margin: '10px 0' }}>
            <input type="checkbox" style={{ width: 'auto', marginTop: 3 }} checked={attest} onChange={(e) => setAttest(e.target.checked)} />
            <span className="muted">These contacts were collected with consent (logged to each lead's consent record — matters if you ever want to text them).</span>
          </label>
          {result && <div className={`banner ${result.ok ? 'ok' : 'err'}`}>{result.text}</div>}
          <button className="btn primary" disabled={busy} onClick={doImport}>Import {rows.length} leads</button>
        </div>
      )}
      {result && !rows && <div className={`banner ${result.ok ? 'ok' : 'err'}`} style={{ marginTop: 12 }}>{result.text}</div>}
    </div>
  )
}
